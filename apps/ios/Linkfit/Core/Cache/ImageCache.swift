import Foundation
import UIKit
import CryptoKit

/// Two-tier image cache:
///   * Tier 1 — NSCache (in-memory, decoded `UIImage`, 64 MB).
///   * Tier 2 — on-disk encoded bytes (LRU, 200 MB cap).
///
/// The disk key is `SHA-256(url.absoluteString)` so callers don't have to
/// sanitize filesystem-unfriendly characters in the URL (query strings,
/// pre-signed S3 garbage, etc.).
///
/// Eviction policy:
///   * Memory: NSCache handles cost-based pressure automatically.
///   * Disk: we walk the directory by mtime (LRU), trimming the tail until
///     the total byte count drops below the cap. Trim runs after every
///     successful store so latency stays bounded.
///
/// Concurrency: an `actor`. All disk and bookkeeping access is serialized.
/// Decoding off the main thread happens inside `image(for:)` after a hit.
actor ImageCache {
    static let shared = ImageCache()

    // MARK: - Configuration

    private let memoryCapacity: Int
    private let diskCapacity: Int
    private let memory: NSCache<NSString, UIImage>
    private let directory: URL
    private let fileManager: FileManager

    /// `memoryCapacity` and `diskCapacity` are bytes. The defaults match the
    /// product target (64 MB RAM / 200 MB disk).
    init(memoryCapacity: Int = 64 * 1024 * 1024,
         diskCapacity: Int = 200 * 1024 * 1024,
         directoryName: String = "LinkfitImageCache",
         baseDirectory: URL? = nil,
         fileManager: FileManager = .default) {
        self.memoryCapacity = memoryCapacity
        self.diskCapacity = diskCapacity
        self.fileManager = fileManager
        let cache = NSCache<NSString, UIImage>()
        cache.totalCostLimit = memoryCapacity
        self.memory = cache

        let base = baseDirectory ?? fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        self.directory = base.appendingPathComponent(directoryName, isDirectory: true)
        try? fileManager.createDirectory(at: self.directory, withIntermediateDirectories: true)
    }

    // MARK: - Public API

    /// Look up a decoded image for `url`. Returns `nil` on miss. Touches the
    /// disk file's mtime on a hit so LRU works.
    func image(for url: URL) async -> UIImage? {
        let key = Self.diskKey(for: url)
        if let cached = memory.object(forKey: key as NSString) {
            return cached
        }
        let fileURL = directory.appendingPathComponent(key)
        
        // Offload disk read and UIImage decoding to background thread
        guard let result = await Task.detached(priority: .userInitiated, operation: { () -> (UIImage, Data)? in
            guard let data = try? Data(contentsOf: fileURL),
                  let image = UIImage(data: data) else {
                return nil
            }
            return (image, data)
        }).value else {
            return nil
        }
        
        let (image, data) = result
        
        // Touch modification time asynchronously
        await Task.detached(priority: .background, operation: {
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: fileURL.path)
        }).value
        
        await store(image: image, data: data, key: key, persistToDisk: false)
        return image
    }

    /// Decode `data` once, hold the resulting image in memory, and persist
    /// the raw bytes to disk. Triggers an LRU trim if disk usage exceeds the
    /// cap.
    func store(_ data: Data, for url: URL) async -> UIImage? {
        // Offload image decode
        guard let image = await Task.detached(priority: .userInitiated, operation: {
            UIImage(data: data)
        }).value else { return nil }
        let key = Self.diskKey(for: url)
        await store(image: image, data: data, key: key, persistToDisk: true)
        return image
    }

    /// Wipe everything (memory + disk). Used by tests and (eventually) by
    /// settings → "Clear cache".
    func clear() async {
        memory.removeAllObjects()
        let dir = directory
        await Task.detached(priority: .background, operation: {
            let fm = FileManager.default
            guard let entries = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else {
                return
            }
            for url in entries {
                try? fm.removeItem(at: url)
            }
        }).value
    }

    /// Sum of every file currently sitting under the cache directory.
    /// Exposed mostly so the eviction test can assert post-trim size.
    func currentDiskBytes() async -> Int {
        let dir = directory
        return await Task.detached(priority: .userInitiated, operation: {
            Self.diskBytes(in: dir, fileManager: FileManager.default)
        }).value
    }

    // MARK: - Internals

    private func store(image: UIImage, data: Data, key: String, persistToDisk: Bool) async {
        memory.setObject(image, forKey: key as NSString, cost: data.count)
        if persistToDisk {
            let fileURL = directory.appendingPathComponent(key)
            await Task.detached(priority: .background, operation: {
                do {
                    try data.write(to: fileURL, options: .atomic)
                } catch {
                    // Disk write failures aren't fatal — memory tier still serves.
                }
            }).value
            await trimDiskIfNeeded()
        }
    }

    private func trimDiskIfNeeded() async {
        let dir = directory
        let cap = diskCapacity
        await Task.detached(priority: .background, operation: {
            let fm = FileManager.default
            let keys: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey, .isRegularFileKey]
            guard let entries = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys) else {
                return
            }
            var items: [(url: URL, size: Int, mtime: Date)] = []
            var total = 0
            for url in entries {
                guard let values = try? url.resourceValues(forKeys: Set(keys)),
                      values.isRegularFile == true else { continue }
                let size = values.fileSize ?? 0
                let mtime = values.contentModificationDate ?? .distantPast
                items.append((url, size, mtime))
                total += size
            }
            guard total > cap else { return }
            // Oldest first → drop until under cap.
            items.sort { $0.mtime < $1.mtime }
            for entry in items {
                if total <= cap { break }
                try? fm.removeItem(at: entry.url)
                total -= entry.size
            }
        }).value
    }

    // MARK: - Helpers

    /// SHA-256 of the URL string, hex-encoded. Stable, collision-free for
    /// practical inputs, safe across filesystems.
    static func diskKey(for url: URL) -> String {
        let digest = SHA256.hash(data: Data(url.absoluteString.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private static func diskBytes(in directory: URL, fileManager: FileManager) -> Int {
        guard let entries = try? fileManager.contentsOfDirectory(at: directory,
                                                                 includingPropertiesForKeys: [.fileSizeKey]) else {
            return 0
        }
        var total = 0
        for url in entries {
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            total += size
        }
        return total
    }
}

/// Loader that bridges between `ImageCache` and SwiftUI views. Lives outside
/// the actor so callers can `await` without piping every method through.
enum ImageLoader {

    /// `data:image/...;base64,...` (and `;...` charset variants we ignore).
    /// Decoded inline — never hits the network or the disk cache. EditProfileView
    /// stores avatars as data URLs so this path matters in practice.
    static func decodeDataURL(_ url: URL) -> UIImage? {
        let str = url.absoluteString
        guard str.hasPrefix("data:") else { return nil }
        guard let commaIndex = str.firstIndex(of: ",") else { return nil }
        let header = str[str.index(str.startIndex, offsetBy: 5)..<commaIndex]
        let payload = String(str[str.index(after: commaIndex)...])
        let isBase64 = header.contains(";base64")
        let data: Data?
        if isBase64 {
            data = Data(base64Encoded: payload, options: .ignoreUnknownCharacters)
        } else if let decoded = payload.removingPercentEncoding {
            data = Data(decoded.utf8)
        } else {
            data = Data(payload.utf8)
        }
        guard let data, let image = UIImage(data: data) else { return nil }
        return image
    }

    /// Look up `url` in the cache; on miss, fetch with the supplied session
    /// and store before returning. Cancellation propagates as usual via
    /// `Task.checkCancellation()`.
    static func load(_ url: URL,
                     cache: ImageCache = .shared,
                     session: URLSession = .shared) async throws -> UIImage {
        if let image = decodeDataURL(url) {
            return image
        }
        if let cached = await cache.image(for: url) {
            return cached
        }
        let (data, _) = try await session.data(from: url)
        try Task.checkCancellation()
        if let image = await cache.store(data, for: url) {
            return image
        }
        throw URLError(.cannotDecodeContentData)
    }
}
