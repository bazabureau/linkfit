import Foundation
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Pairs a SwiftUI view with the size the `ImageRenderer` should
/// propose. Wrapped in a struct so the `MainActor.run` closure in
/// `ShareCardRenderer.renderStoryPNG` can return a single value
/// while keeping the view generic — Swift 6 strict concurrency
/// complains if we try to capture an `inout` size alongside a
/// non-Sendable view closure.
struct ProposedSizeRenderer<Content: View> {
    let content: Content
    let size: CGSize
}

/// Errors produced while rasterising a `MatchResultCard`.
enum ShareCardRenderError: LocalizedError, Equatable {
    case rasterizationFailed
    case pngEncodingFailed
    case fileWriteFailed(String)

    var errorDescription: String? {
        switch self {
        case .rasterizationFailed:
            return String(localized: "share_card.error.rasterize")
        case .pngEncodingFailed:
            return String(localized: "share_card.error.png")
        case .fileWriteFailed(let path):
            return String(format: String(localized: "share_card.error.write_format"), path)
        }
    }
}

/// Serialises share-card rasterisation through a single actor so we never
/// hammer `ImageRenderer` from multiple call-sites concurrently — the
/// renderer is `@MainActor`-bound under the hood and one-card-at-a-time
/// keeps the UI hitch-free.
///
/// Why an actor and not a struct of static funcs? Two reasons:
/// 1. Future state — share-card analytics ("how many cards rendered per
///    session?") naturally live here without leaking globals.
/// 2. Safe queueing — the actor naturally serialises overlapping share
///    taps so we don't allocate two 1080×1920 backing stores in parallel.
actor ShareCardRenderer {

    /// Singleton — the renderer is stateless today; injecting a fresh one
    /// per call would still be safe, but a shared instance keeps API call
    /// sites clean.
    static let shared = ShareCardRenderer()

    /// Renders the supplied card into PNG `Data`.
    ///
    /// The view is laid out at `variant.pointSize` and rasterised at 3x
    /// (Retina-quality), so the resulting PNG matches what the user sees
    /// on a 3x device, ready to upload anywhere.
    func renderPNG(data: ShareCardData, variant: ShareCardVariant) async throws -> Data {
        let pngData = await MainActor.run { () -> Data? in
            let view = MatchResultCard(data: data, variant: variant)
            let renderer = ImageRenderer(content: view)
            renderer.scale = 3
            // Important: declared bounds match the view's intrinsic frame
            // exactly so we don't get padding bleed-through.
            renderer.proposedSize = ProposedViewSize(variant.pointSize)
            #if canImport(UIKit)
            guard let uiImage = renderer.uiImage else { return nil }
            return uiImage.pngData()
            #else
            return nil
            #endif
        }
        guard let payload = pngData else {
            throw ShareCardRenderError.rasterizationFailed
        }
        // Belt-and-braces: confirm the byte stream is valid PNG-ish.
        // PNG signature is the 8 magic bytes 89 50 4E 47 0D 0A 1A 0A.
        guard payload.count > 8,
              payload.starts(with: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) else {
            throw ShareCardRenderError.pngEncodingFailed
        }
        return payload
    }

    /// Renders and saves the card to a unique file in `NSTemporaryDirectory`
    /// so the share sheet has a real on-disk `URL` to hand to host apps
    /// (Instagram in particular requires a file URL, not in-memory bytes).
    ///
    /// The caller is free to keep the URL until the share sheet dismisses;
    /// the file lives in `tmp/` and the OS will clean it up.
    func writeTemporaryPNG(
        data: ShareCardData,
        variant: ShareCardVariant
    ) async throws -> URL {
        let payload = try await renderPNG(data: data, variant: variant)
        return try await writeToTmp(payload: payload, suffix: variant == .story ? "result-story" : "result-square")
    }

    // MARK: - Wave-10 cards
    //
    // Rasterises the two new story-aspect cards introduced in Wave-10
    // (`GameJoinedCard`, `MilestoneCard`) through the same actor
    // queue so we never double-allocate 1080×1920 backing stores in
    // parallel. The existing `MatchResultCard` rendering above
    // stays untouched.

    /// Render and persist a `GameJoinedCard` (story variant) to a
    /// temporary PNG. Returns the file URL, ready for
    /// `UIActivityViewController`.
    func writeJoinedCard(_ data: GameJoinedCardData) async throws -> URL {
        let storySize = ShareCardVariant.story.pointSize
        let payload = try await renderStoryPNG { ProposedSizeRenderer(
            content: GameJoinedCard(data: data), size: storySize
        ) }
        return try await writeToTmp(payload: payload, suffix: "joined")
    }

    /// Render and persist a `MilestoneCard` (story variant) to a
    /// temporary PNG.
    func writeMilestoneCard(_ data: MilestoneCardData) async throws -> URL {
        let storySize = ShareCardVariant.story.pointSize
        let payload = try await renderStoryPNG { ProposedSizeRenderer(
            content: MilestoneCard(data: data), size: storySize
        ) }
        return try await writeToTmp(payload: payload, suffix: "milestone")
    }

    // MARK: - Internal helpers

    /// Rasterise a `ProposedSizeRenderer`-wrapped view at the story
    /// aspect ratio (1080×1920 at 3x). Centralises the
    /// `ImageRenderer` setup so the Wave-10 card entry points stay
    /// one-liners. The closure runs on the main actor.
    private func renderStoryPNG<V: View>(
        _ make: @MainActor @Sendable @escaping () -> ProposedSizeRenderer<V>
    ) async throws -> Data {
        let pngData = await MainActor.run { () -> Data? in
            let wrapper = make()
            let renderer = ImageRenderer(content: wrapper.content)
            renderer.scale = 3
            renderer.proposedSize = ProposedViewSize(wrapper.size)
            #if canImport(UIKit)
            guard let uiImage = renderer.uiImage else { return nil }
            return uiImage.pngData()
            #else
            return nil
            #endif
        }
        guard let payload = pngData else {
            throw ShareCardRenderError.rasterizationFailed
        }
        guard payload.count > 8,
              payload.starts(with: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) else {
            throw ShareCardRenderError.pngEncodingFailed
        }
        return payload
    }

    private func writeToTmp(payload: Data, suffix: String) async throws -> URL {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory(),
                      isDirectory: true)
        let url = dir.appendingPathComponent("linkfit-\(suffix)-\(UUID().uuidString).png")
        do {
            try payload.write(to: url, options: .atomic)
        } catch {
            throw ShareCardRenderError.fileWriteFailed(url.lastPathComponent)
        }
        return url
    }
}
