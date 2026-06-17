import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Circular avatar that loads an image (memory-cached) and falls back to colored
/// initials. Self-contained in DesignSystem — no Persistence dependency.
public struct Avatar: View {
    private let url: URL?
    private let initials: String
    private let size: CGFloat

    public init(url: URL?, initials: String, size: CGFloat = 44) {
        self.url = url
        self.initials = initials
        self.size = size
    }

    public var body: some View {
        Group {
            if let url {
                CachedAsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    fallback
                }
            } else {
                fallback
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(DSColor.border, lineWidth: 1))
    }

    private var fallback: some View {
        ZStack {
            DSColor.accentMuted
            Text(initials)
                .font(.system(size: size * 0.38, weight: .heavy))
                .foregroundStyle(DSColor.accent)
        }
    }
}

/// Lightweight image loader with an in-memory cache and a small disk-backed
/// `URLCache`. Keeps avatars/photos from re-fetching as lists scroll.
public struct CachedAsyncImage<Content: View, Placeholder: View>: View {
    private let url: URL
    private let content: (Image) -> Content
    private let placeholder: () -> Placeholder

    @State private var loaded: Image?

    public init(
        url: URL,
        @ViewBuilder content: @escaping (Image) -> Content,
        @ViewBuilder placeholder: @escaping () -> Placeholder
    ) {
        self.url = url
        self.content = content
        self.placeholder = placeholder
    }

    public var body: some View {
        Group {
            if let loaded {
                content(loaded)
            } else {
                placeholder()
            }
        }
        .task(id: url) { await load() }
    }

    private func load() async {
        if let cached = ImageMemoryCache.shared.image(for: url) {
            loaded = cached
            return
        }
        do {
            let (data, _) = try await ImageMemoryCache.session.data(from: url)
            #if canImport(UIKit)
            if let uiImage = UIImage(data: data) {
                let image = Image(uiImage: uiImage)
                ImageMemoryCache.shared.store(image, for: url)
                loaded = image
            }
            #endif
        } catch {
            // Leave the placeholder in place on failure.
        }
    }
}

/// Process-wide image cache. `nonisolated(unsafe)` is sound: `NSCache` is
/// internally synchronized, and `URLSession` is `Sendable`.
final class ImageMemoryCache: @unchecked Sendable {
    static let shared = ImageMemoryCache()

    nonisolated(unsafe) static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 16 * 1024 * 1024, diskCapacity: 64 * 1024 * 1024)
        config.requestCachePolicy = .returnCacheDataElseLoad
        return URLSession(configuration: config)
    }()

    private let cache = NSCache<NSURL, ImageBox>()

    func image(for url: URL) -> Image? {
        cache.object(forKey: url as NSURL)?.image
    }

    func store(_ image: Image, for url: URL) {
        cache.setObject(ImageBox(image), forKey: url as NSURL)
    }
}

final class ImageBox {
    let image: Image
    init(_ image: Image) { self.image = image }
}
