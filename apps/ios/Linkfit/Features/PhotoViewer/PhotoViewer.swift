import Photos
import SwiftUI

/// Full-screen photo viewer for image attachments.
///
/// Visual:
///   * Black, edge-to-edge canvas (chrome that flanks the image is intentionally
///     translucent so the image remains the focus).
///   * `CachedAsyncImage` loads from the shared cache — when the user taps a
///     thumbnail in chat the network request has usually already settled, so
///     the full-res frame snaps in without a spinner.
///
/// Gestures (composed via `SimultaneousGesture`):
///   * Pinch — clamped to **1.0–6.0**. Below 1.0 the image is meaningless
///     (it's smaller than the bubble it was tapped from); 6× covers reading
///     handwriting / fine print without letting the user lose the image.
///   * Pan — only meaningful while zoomed; clamped to the image bounds so the
///     user can't drag the photo off-screen and lose it behind the chrome.
///   * Double-tap — toggles **1× ↔ 2.5×**. 2.5× is the "I want a closer look
///     without committing to pinch" preset; tapping again returns to fit.
///   * Drag-down at 1× — accumulates a translation; >120 pt or a fast flick
///     (>600 pt/s) dismisses. While dragging, the background fades to give
///     the standard iOS "rubber-band toward dismiss" feel. Dragging is
///     intentionally disabled while zoomed so the user can pan a zoomed photo
///     without accidentally closing the viewer.
///
/// Toolbar:
///   * Top-left X dismisses immediately.
///   * Top-right square-and-arrow-up saves to the Photo Library (add-only
///     authorization → `PHPhotoLibrary.performChanges`).
///
/// Save flow:
///   1. Resolve the on-device `UIImage` either from the `CachedAsyncImage`
///      success phase (already decoded) or by downloading via `URLSession`
///      as a fallback when the user hits Save before the image finishes
///      loading.
///   2. Request `PHPhotoLibrary.requestAuthorization(for: .addOnly)`. Add-only
///      means the user grants permission to write without exposing their
///      library — no `NSPhotoLibraryUsageDescription` prompt needed beyond
///      the `Add` key already declared in `project.yml`.
///   3. On a successful `performChanges` block, surface an in-viewer toast
///      ("Saved to Photos"). On denial / restricted / failure we stay silent;
///      the user will retry or settle for the existing context-menu save in
///      the message bubble.
struct PhotoViewer: View {
    let imageURL: URL
    let onDismiss: () -> Void

    init(imageURL: URL, onDismiss: @escaping () -> Void) {
        self.imageURL = imageURL
        self.onDismiss = onDismiss
    }

    // Loaded image — the same instance we hand to PHPhotoLibrary on save so we
    // never re-download a photo the user is already looking at.
    @State private var loaded: UIImage?
    @State private var loadFailed = false

    // Commit / gesture pairs. Live gesture deltas fold into the committed
    // value on `onEnded`; this lets us keep the gesture math monotonic and
    // free of jumps when the user lifts a finger mid-pinch.
    @State private var committedScale: CGFloat = 1
    @State private var gestureScale: CGFloat = 1
    @State private var committedOffset: CGSize = .zero
    @State private var gestureOffset: CGSize = .zero

    // Drag-to-dismiss state — only consulted while at 1×.
    @State private var dragOffset: CGSize = .zero

    // Save UX. `saving` blocks the toolbar button while the write is in
    // flight; `savedToast` triggers a fade-out HUD on success.
    @State private var saving = false
    @State private var savedToast = false

    private let minScale: CGFloat = 1.0
    private let maxScale: CGFloat = 6.0
    private let doubleTapScale: CGFloat = 2.5
    private let dismissDistance: CGFloat = 120
    private let dismissVelocity: CGFloat = 600

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                // Black bed. Opacity drops as the user drags toward dismissal
                // so the photo visibly detaches from the surface it's sitting
                // on — a small but load-bearing cue that "let go now" closes
                // the viewer.
                Color.black
                    .opacity(backgroundOpacity)
                    .ignoresSafeArea()

                imageLayer(in: proxy.size)

                chrome
                    .opacity(chromeOpacity)

                if savedToast {
                    savedToastView
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .contentShape(Rectangle())
        }
        .statusBarHidden(true)
        .task { await preload() }
    }

    // MARK: - Image layer

    @ViewBuilder
    private func imageLayer(in size: CGSize) -> some View {
        let totalScale = committedScale * gestureScale
        let totalOffset = CGSize(
            width: committedOffset.width + gestureOffset.width + dragOffset.width,
            height: committedOffset.height + gestureOffset.height + dragOffset.height
        )

        CachedAsyncImage(url: imageURL, transaction: Transaction(animation: .easeInOut)) { phase in
            switch phase {
            case .empty:
                ProgressView().tint(.white)
            case .success(let image):
                image
                    .resizable()
                    .scaledToFit()
                    .onAppear { resolveUIImageIfNeeded() }
            case .failure:
                VStack(spacing: 8) {
                    Image(systemName: "photo.badge.exclamationmark")
                        .font(.system(size: 40))
                        .foregroundStyle(.white.opacity(0.75))
                    Text("messages.image_failed")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.75))
                }
                .onAppear { loadFailed = true }
            @unknown default:
                EmptyView()
            }
        }
        .scaleEffect(totalScale)
        .offset(totalOffset)
        .gesture(gestureComposition(containerSize: size))
        .onTapGesture(count: 2) { handleDoubleTap() }
    }

    // MARK: - Chrome

    private var chrome: some View {
        VStack {
            HStack {
                toolbarButton(systemName: "xmark") {
                    onDismiss()
                }
                .accessibilityLabel(Text("common.close"))

                Spacer()

                toolbarButton(systemName: "square.and.arrow.down") {
                    Task { await saveToPhotos() }
                }
                .accessibilityLabel(Text("photo_viewer.action.save"))
                .disabled(saving)
                .opacity(saving ? 0.5 : 1)
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.top, DSSpacing.sm)

            Spacer()
        }
    }

    private func toolbarButton(systemName: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 18, weight: .semibold))
                .frame(width: 40, height: 40)
                .foregroundStyle(.white)
                .background(
                    Circle().fill(Color.black.opacity(0.45))
                )
        }
    }

    private var savedToastView: some View {
        VStack {
            Spacer().frame(height: 80)
            Text("photo_viewer.saved")
                .font(.system(.subheadline, design: .rounded).weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, DSSpacing.md)
                .padding(.vertical, 10)
                .background(
                    Capsule().fill(Color.black.opacity(0.7))
                )
            Spacer()
        }
        .allowsHitTesting(false)
    }

    // MARK: - Gesture composition

    private func gestureComposition(containerSize: CGSize) -> some Gesture {
        // The drag gesture splits behaviour on `committedScale`:
        //   * At 1× we treat it as a swipe-down-to-dismiss handle.
        //   * Above 1× we treat it as a pan that nudges the committed offset
        //     so the user can scrub across a zoomed photo.
        let drag = DragGesture()
            .onChanged { value in
                if committedScale <= minScale + 0.01 {
                    // Only react to predominantly-downward drags — sideways
                    // swipes shouldn't fade the viewer.
                    if value.translation.height > 0 {
                        dragOffset = CGSize(width: value.translation.width * 0.3,
                                            height: value.translation.height)
                    }
                } else {
                    gestureOffset = value.translation
                }
            }
            .onEnded { value in
                if committedScale <= minScale + 0.01 {
                    let v = value.predictedEndTranslation.height - value.translation.height
                    if value.translation.height > dismissDistance || v > dismissVelocity {
                        withAnimation(.easeOut(duration: 0.18)) {
                            dragOffset = CGSize(width: 0, height: containerSize.height)
                        }
                        // Hand off to the parent once the slide-out animation
                        // has had time to play; the parent owns the actual
                        // `fullScreenCover` dismissal.
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
                            onDismiss()
                        }
                    } else {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                            dragOffset = .zero
                        }
                    }
                } else {
                    let combined = CGSize(
                        width: committedOffset.width + value.translation.width,
                        height: committedOffset.height + value.translation.height
                    )
                    committedOffset = clampOffset(combined,
                                                  scale: committedScale,
                                                  containerSize: containerSize)
                    gestureOffset = .zero
                }
            }

        let zoom = MagnificationGesture()
            .onChanged { value in
                gestureScale = value
            }
            .onEnded { value in
                let folded = committedScale * value
                let clamped = min(maxScale, max(minScale, folded))
                withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                    committedScale = clamped
                    gestureScale = 1
                    if clamped <= minScale + 0.01 {
                        committedOffset = .zero
                    } else {
                        committedOffset = clampOffset(committedOffset,
                                                      scale: clamped,
                                                      containerSize: containerSize)
                    }
                }
            }

        return SimultaneousGesture(zoom, drag)
    }

    private func handleDoubleTap() {
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
            if committedScale > minScale + 0.01 {
                committedScale = minScale
                committedOffset = .zero
            } else {
                committedScale = doubleTapScale
            }
        }
    }

    /// Roughly constrain the offset so a zoomed image can't be panned beyond
    /// its own bounds. We don't know the rendered image rect from SwiftUI
    /// (scaledToFit doesn't expose it), so we treat the container as a proxy
    /// — accurate enough that the photo never disappears from view.
    private func clampOffset(_ offset: CGSize,
                             scale: CGFloat,
                             containerSize: CGSize) -> CGSize {
        let extra = max(0, scale - 1)
        let limitX = containerSize.width * extra / 2
        let limitY = containerSize.height * extra / 2
        return CGSize(
            width: min(limitX, max(-limitX, offset.width)),
            height: min(limitY, max(-limitY, offset.height))
        )
    }

    // MARK: - Background / chrome opacity

    /// As the user drags toward dismissal, fade the canvas from solid black
    /// (1.0) down to ~0.4 so the underlying view bleeds through. Returns 1.0
    /// when not actively dragging or when zoomed.
    private var backgroundOpacity: Double {
        guard dragOffset.height > 0 else { return 1.0 }
        let progress = min(1, dragOffset.height / 300)
        return 1.0 - Double(progress) * 0.6
    }

    /// Chrome hides while pinching/panning a zoomed photo so the user gets a
    /// clean canvas. Otherwise it stays fully visible.
    private var chromeOpacity: Double {
        if committedScale > minScale + 0.01 || gestureScale != 1 { return 0.3 }
        if dragOffset.height > 40 { return 0 }
        return 1
    }

    // MARK: - Save to Photos

    /// Pre-fetch the full-resolution image into `loaded` so the save button
    /// is responsive the moment the user taps it. Failures fall through —
    /// the save path tries again over the wire.
    private func preload() async {
        guard loaded == nil else { return }
        if let image = try? await ImageLoader.load(imageURL) {
            await MainActor.run { loaded = image }
        }
    }

    /// Triggered from the CachedAsyncImage success branch — `Image` is a
    /// SwiftUI value type, so we re-fetch the `UIImage` from the cache to
    /// hand to PHPhotoLibrary. The loader hits the in-memory cache on a
    /// path the view already populated, so this is cheap.
    private func resolveUIImageIfNeeded() {
        guard loaded == nil else { return }
        Task { await preload() }
    }

    @MainActor
    private func saveToPhotos() async {
        guard !saving else { return }
        saving = true
        defer { saving = false }

        // Resolve the bytes — prefer the already-decoded `UIImage`, fall back
        // to a direct fetch in case the user mashed Save before preload was
        // done.
        let image: UIImage
        if let cached = loaded {
            image = cached
        } else if let fetched = try? await ImageLoader.load(imageURL) {
            loaded = fetched
            image = fetched
        } else {
            return
        }

        // Add-only authorization: the user grants permission to write to the
        // library without exposing reads. `.addOnly` is the right scope for
        // "save this image" flows — declined by the system if we ask for
        // `.readWrite` we don't actually need.
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else { return }

        do {
            try await PHPhotoLibrary.shared().performChanges {
                PHAssetCreationRequest.creationRequestForAsset(from: image)
            }
            await showSavedToast()
        } catch {
            // Surface nothing — the message bubble's context-menu save flow
            // remains a viable retry. We avoid alerting on a failed write to
            // the camera roll since it's almost always a transient permission
            // edge case rather than something the user can act on here.
        }
    }

    private func showSavedToast() async {
        withAnimation(.easeInOut(duration: 0.2)) {
            savedToast = true
        }
        try? await Task.sleep(nanoseconds: 1_700_000_000)
        withAnimation(.easeInOut(duration: 0.3)) {
            savedToast = false
        }
    }
}
