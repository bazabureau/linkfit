import XCTest
import UIKit
@testable import Linkfit

final class ImageCacheTests: XCTestCase {

    private var sandbox: URL!

    override func setUp() {
        super.setUp()
        sandbox = FileManager.default.temporaryDirectory
            .appendingPathComponent("ImageCacheTests-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: sandbox, withIntermediateDirectories: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: sandbox)
        sandbox = nil
        super.tearDown()
    }

    // MARK: - Helpers

    /// Builds a small but real PNG of a solid color, so `UIImage(data:)` round-trips.
    private func makeImageData(side: CGFloat = 8, hue: CGFloat = 0.3) -> Data {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side))
        let image = renderer.image { ctx in
            UIColor(hue: hue, saturation: 0.9, brightness: 0.9, alpha: 1).setFill()
            ctx.cgContext.fill(CGRect(x: 0, y: 0, width: side, height: side))
        }
        return image.pngData()!
    }

    private func makeCache(memory: Int = 4 * 1024 * 1024,
                          disk: Int = 4 * 1024 * 1024) -> ImageCache {
        ImageCache(memoryCapacity: memory,
                   diskCapacity: disk,
                   directoryName: "tier",
                   baseDirectory: sandbox)
    }

    // MARK: - Tests

    func testStoreThenHitReturnsImage() async {
        let cache = makeCache()
        let url = URL(string: "https://example.com/a.png")!
        let data = makeImageData()

        let stored = await cache.store(data, for: url)
        XCTAssertNotNil(stored, "store should decode the PNG payload")

        let hit = await cache.image(for: url)
        XCTAssertNotNil(hit, "cache must return a decoded image on hit")
    }

    func testMissReturnsNil() async {
        let cache = makeCache()
        let url = URL(string: "https://example.com/never-stored.png")!
        let result = await cache.image(for: url)
        XCTAssertNil(result, "unknown URL must miss cleanly")
    }

    func testDataURLDecodesInlineWithoutCache() {
        let data = makeImageData()
        let dataURL = URL(string: "data:image/png;base64,\(data.base64EncodedString())")!
        let image = ImageLoader.decodeDataURL(dataURL)
        XCTAssertNotNil(image, "data: URI must be decoded inline")
    }

    func testDataURLRejectsNonDataScheme() {
        let url = URL(string: "https://example.com/a.png")!
        XCTAssertNil(ImageLoader.decodeDataURL(url),
                     "decodeDataURL must only accept data: scheme")
    }

    func testDiskKeyIsDeterministic() {
        let url = URL(string: "https://example.com/x?token=abc")!
        XCTAssertEqual(ImageCache.diskKey(for: url), ImageCache.diskKey(for: url))
        XCTAssertEqual(ImageCache.diskKey(for: url).count, 64,
                       "SHA-256 hex string should be 64 chars")
    }

    func testDiskEvictionRespectsCap() async {
        // Tiny cap so a couple of stores force eviction.
        let cap = 8 * 1024 // 8 KB
        let cache = ImageCache(memoryCapacity: cap,
                               diskCapacity: cap,
                               directoryName: "evict",
                               baseDirectory: sandbox)

        // Each PNG is bigger than a single entry would tolerate alongside others.
        let payload = makeImageData(side: 64, hue: 0.5) // ~hundreds of bytes after PNG compression; bump until > cap
        // Fill until we exceed the cap several times over.
        for i in 0..<20 {
            let url = URL(string: "https://example.com/evict-\(i).png")!
            _ = await cache.store(payload, for: url)
        }

        let bytes = await cache.currentDiskBytes()
        XCTAssertLessThanOrEqual(bytes, cap,
                                 "disk LRU must trim back under the configured cap, was \(bytes)")
    }

    func testClearWipesEverything() async {
        let cache = makeCache()
        let url = URL(string: "https://example.com/clear.png")!
        _ = await cache.store(makeImageData(), for: url)
        let cachedBeforeClear = await cache.image(for: url)
        XCTAssertNotNil(cachedBeforeClear)

        await cache.clear()
        let cachedAfterClear = await cache.image(for: url)
        let diskBytes = await cache.currentDiskBytes()
        XCTAssertNil(cachedAfterClear, "clear() must drop both tiers")
        XCTAssertEqual(diskBytes, 0)
    }
}
