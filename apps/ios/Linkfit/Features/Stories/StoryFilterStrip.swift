import SwiftUI
import UIKit

/// Horizontal swipeable thumbnail row that lets the user pick an
/// Instagram-style filter for the story photo. Sits at the bottom of
/// `StoryEditorView`, above the "İrəli" Next button.
///
/// **Layout.**
///
/// ```
///   ┌────┬────┬────┬────┬────┬────┬────┬────┬────┐
///   │ ▣ │ ▣ │ ▣ │ ▣ │ ▣ │ ▣ │ ▣ │ ▣ │ ▣ │   ← 60pt tiles, lime ring
///   │Or │Bk │Xz │Yn │Qx │Nr │Sp │Fd │Vv │     on selected
///   └────┴────┴────┴────┴────┴────┴────┴────┴────┘
/// ```
///
/// **Thumbnails.** Each tile renders the user's actual photo with the
/// filter applied, so the strip behaves as a true preview not a static
/// swatch. Renders are computed lazily on appear via a background task
/// and cached in a `@State` dictionary keyed by filter — this is per-
/// strip-instance, which is fine because the editor only mounts the strip
/// once per photo.
///
/// **Coordination.** The strip writes the selected filter back to
/// `StoryEditorViewModel.selectedFilter`. The editor's main image view
/// reads that field via the VM's `filteredImage` computed and re-renders
/// the full-res preview on every tap (full-res renders on a 4K photo are
/// ~30ms on an A17, which is over a frame; we accept the latency rather
/// than down-rezzing the live preview because dropping resolution would
/// make the filter selection feel unfaithful).
///
/// **Performance.** Thumbnail renders run on a detached Task off the main
/// thread. The renderer's shared `CIContext` is thread-safe (Apple docs)
/// so concurrent renders are fine; we serialise them anyway (`for` loop
/// awaiting each) to keep the GPU queue from thrashing on a cold start.
struct StoryFilterStrip: View {
    /// VM whose `selectedFilter` we drive and whose `image` we render
    /// thumbnails from. Bindable so `selectedFilter` changes propagate
    /// out to the parent's live preview.
    @Bindable var viewModel: StoryEditorViewModel

    /// Per-filter cached thumbnail. Populated on appear; reads from this
    /// dict are cheap (constant time) and SwiftUI re-renders when a new
    /// entry lands.
    @State private var thumbnails: [StoryFilter: UIImage] = [:]

    /// True while the initial background render pass is in flight. We
    /// don't surface this to the user (no spinner) — the placeholder
    /// dim-source-image tiles look fine while the real renders settle.
    @State private var isRendering = false

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(StoryFilter.allCases) { filter in
                    tile(for: filter)
                }
            }
            .padding(.horizontal, 16)
        }
        .frame(height: 92)  // 60pt tile + 8pt gap + 14pt label + breathing room
        // Subtle dark wash behind the strip so the tiles read against
        // bright photos. `ultraThinMaterial` would be nicer but it
        // jumps when iOS recalculates the blur on filter change.
        .background(
            LinearGradient(
                colors: [Color.black.opacity(0.0), Color.black.opacity(0.55)],
                startPoint: .top,
                endPoint: .bottom
            )
            .allowsHitTesting(false)
        )
        .task {
            // Kick off the thumbnail render pass once the strip is on
            // screen. `.task` (not `.onAppear`) so the work cancels if
            // the user dismisses the editor mid-render.
            await renderThumbnails()
        }
    }

    // MARK: - Tile

    /// One filter tile: thumbnail square + AZ label. Selected tile gets a
    /// lime accent ring (matches the rest of the editor's selection
    /// chrome — handle rings on overlays use the same `DSColor.accent`).
    @ViewBuilder
    private func tile(for filter: StoryFilter) -> some View {
        let isSelected = viewModel.selectedFilter == filter
        Button {
            // Light haptic on selection — matches IG's tactile feedback
            // when scrubbing the filter row.
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            withAnimation(.easeOut(duration: 0.18)) {
                viewModel.selectedFilter = filter
            }
        } label: {
            VStack(spacing: 6) {
                thumbnail(for: filter)
                    .frame(width: 60, height: 60)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            // The lime ring on the selected tile. We
                            // stroke at 2.5pt so it's visible even on
                            // dark photos but not so chunky that it
                            // eats the tile's preview area.
                            .strokeBorder(
                                isSelected ? DSColor.accent : Color.white.opacity(0.18),
                                lineWidth: isSelected ? 2.5 : 1
                            )
                    )
                    .scaleEffect(isSelected ? 1.06 : 1.0)
                Text(LocalizedStringKey(filter.localizationKey))
                    .font(.system(size: 11, weight: isSelected ? .heavy : .semibold))
                    .foregroundStyle(isSelected ? DSColor.accent : Color.white.opacity(0.85))
                    .lineLimit(1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(LocalizedStringKey(filter.localizationKey)))
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    /// Either the cached filter thumbnail or a dimmed copy of the
    /// source image while we wait for the renderer. The placeholder is
    /// the SAME image so the strip never shows a blank box; tiles just
    /// look slightly washed-out until the real render lands.
    @ViewBuilder
    private func thumbnail(for filter: StoryFilter) -> some View {
        if let cached = thumbnails[filter] {
            Image(uiImage: cached)
                .resizable()
                .scaledToFill()
        } else {
            // Source image as a placeholder, dimmed so the tile reads as
            // "loading" without a spinner. Once `renderThumbnails()`
            // populates the dict, the real preview replaces this.
            Image(uiImage: viewModel.image)
                .resizable()
                .scaledToFill()
                .opacity(0.5)
        }
    }

    // MARK: - Render pass

    /// Background thumbnail render. Iterates `StoryFilter.allCases` and
    /// populates `thumbnails` one at a time. Serialising the loop (rather
    /// than firing 9 concurrent tasks) keeps the GPU queue depth bounded
    /// and lets each thumbnail land on screen as soon as it's ready —
    /// the user sees the strip fill in left-to-right.
    private func renderThumbnails() async {
        guard thumbnails.isEmpty else { return }
        isRendering = true
        defer { isRendering = false }

        // Snapshot the source image. The `viewModel` is `@MainActor`
        // (it's the editor VM) so we read it on the calling main-actor
        // context and ship the image to the off-main detached task.
        let source = viewModel.image

        for filter in StoryFilter.allCases {
            // Honour task cancellation — if the user dismisses the
            // editor we want the background work to stop.
            if Task.isCancelled { return }
            // Each render hops to a background thread via
            // `Task.detached`. We re-await on main so the SwiftUI state
            // mutation happens on the main actor.
            let rendered: UIImage = await Task.detached(priority: .userInitiated) {
                StoryFilterRenderer.apply(filter: filter, to: source, thumbnail: true)
            }.value
            if Task.isCancelled { return }
            thumbnails[filter] = rendered
        }
    }
}
