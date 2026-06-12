import SwiftUI

/// Drop-in replacement for SwiftUI's `AsyncImage` backed by `ImageCache`.
///
/// Surface area:
///   * `init(url:scale:content:placeholder:)` — mirrors AsyncImage's
///     "give me the image, give me the placeholder" convenience initializer.
///   * `init(url:scale:transaction:content:)` — mirrors AsyncImage's phase
///     initializer; needed by `ImageAttachmentBubble` which switches on
///     `.empty / .success / .failure`.
///
/// Behavior:
///   * Cancels the in-flight fetch when the view disappears.
///   * Decodes `data:image/...` URIs inline (no network).
///   * Otherwise consults `ImageCache.shared` then falls back to URLSession.
struct CachedAsyncImage<Content: View, Placeholder: View>: View {
    private let url: URL?
    private let scale: CGFloat
    private let transaction: Transaction
    private let content: (AsyncImagePhase) -> Content
    private let placeholderFactory: (() -> Placeholder)?

    @State private var phase: AsyncImagePhase = .empty
    @State private var loadTask: Task<Void, Never>?

    // MARK: - Phase-style init (matches AsyncImage(url:transaction:content:))

    init(url: URL?,
         scale: CGFloat = 1,
         transaction: Transaction = Transaction(),
         @ViewBuilder content: @escaping (AsyncImagePhase) -> Content)
    where Placeholder == EmptyView {
        self.url = url
        self.scale = scale
        self.transaction = transaction
        self.content = content
        self.placeholderFactory = nil
    }

    // MARK: - Convenience init (matches AsyncImage(url:scale:content:placeholder:))

    init(url: URL?,
         scale: CGFloat = 1,
         @ViewBuilder content: @escaping (Image) -> Content,
         @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.url = url
        self.scale = scale
        self.transaction = Transaction()
        // The body never invokes this closure on `.empty / .failure` when a
        // placeholder factory exists — but we still need a total function
        // typed `(AsyncImagePhase) -> Content`, so fall back to a stub image
        // for the unreachable branch.
        let mappedContent: (AsyncImagePhase) -> Content = { phase in
            content(phase.image ?? Image(systemName: "photo"))
        }
        self.content = mappedContent
        self.placeholderFactory = placeholder
    }

    // MARK: - Body

    var body: some View {
        Group {
            if let factory = placeholderFactory {
                // Convenience path: show placeholder until we have an image,
                // then show content(image). No "failure" UI — matches AsyncImage.
                if case .success(let image) = phase {
                    content(.success(image))
                } else {
                    factory()
                }
            } else {
                content(phase)
            }
        }
        .onAppear { startLoading() }
        .onDisappear {
            loadTask?.cancel()
            loadTask = nil
        }
        .onChange(of: url) { _, _ in
            loadTask?.cancel()
            phase = .empty
            startLoading()
        }
    }

    private func startLoading() {
        guard loadTask == nil else { return }
        guard let url else {
            phase = .empty
            return
        }
        // data: URIs decode synchronously — skip the Task spin-up.
        if let inline = ImageLoader.decodeDataURL(url) {
            withTransaction(transaction) {
                phase = .success(Image(uiImage: inline))
            }
            return
        }
        loadTask = Task { @MainActor in
            do {
                let image = try await ImageLoader.load(url)
                try Task.checkCancellation()
                withTransaction(transaction) {
                    phase = .success(Image(uiImage: image))
                }
            } catch is CancellationError {
                // View went away; don't touch state.
            } catch {
                withTransaction(transaction) {
                    phase = .failure(error)
                }
            }
            loadTask = nil
        }
    }
}
