import SwiftUI
import UIKit

/// Reusable square-crop editor with a circular preview mask.
///
/// Designed for two callers: the profile avatar uploader and the venue photo
/// uploader. Both want a square crop, both want the preview to look like a
/// circle (because the avatar is shown circularly elsewhere in the app), and
/// both want to keep the output small enough that the upload doesn't stall on
/// 3G — hence the 150 KB JPEG cap.
///
/// The view is push-button: the caller hands us a `UIImage`, we hand back a
/// cropped + downsized `UIImage` via `onConfirm`, and we stay
/// stateless about *what* the caller is going to do with it. No upload
/// plumbing here, no view-models — those live with the caller.
///
/// The cropped image is delivered as a `UIImage` (not Data) so callers can
/// choose what to do with it (preview locally, encode to JPEG, etc.). For the
/// upload path callers should use `CropMath.encodeJPEG(_:maxBytes:)` with a
/// 150 000-byte budget; the view also pre-renders a JPEG-friendly size so
/// that encoding ends up tiny in practice.
struct PhotoCropView: View {

    // MARK: - Inputs

    /// Source image. Captured at init — we don't observe changes; this view
    /// is a one-shot editor.
    let image: UIImage

    /// Called when the user taps Cancel (top-left). Caller is responsible for
    /// dismissing the sheet / popping the route.
    let onCancel: () -> Void

    /// Called when the user taps Done (top-right). Receives a square
    /// `UIImage` at `outputSize` x `outputSize` pixels. The caller dismisses.
    let onConfirm: (UIImage) -> Void

    /// Final image side, in pixels. 800 is the canonical avatar size — large
    /// enough for retina @3x at typical avatar display sizes (~80pt circle),
    /// small enough to keep JPEGs well under the 150 KB cap.
    let outputSize: CGFloat

    init(
        image: UIImage,
        outputSize: CGFloat = 800,
        onCancel: @escaping () -> Void,
        onConfirm: @escaping (UIImage) -> Void
    ) {
        self.image = image
        self.outputSize = outputSize
        self.onCancel = onCancel
        self.onConfirm = onConfirm
    }

    // MARK: - Gesture state
    //
    // Two pieces of state per axis (current + committed) is the canonical
    // SwiftUI pattern for "pinch and let go, then pinch again from the
    // current zoom." On gesture .changed we read committed * gesture, on
    // .ended we fold gesture into committed and reset gesture to 1 / .zero.

    /// Committed zoom — what survives between gestures.
    @State private var committedScale: CGFloat = 1
    /// Live zoom delta from the in-flight magnification gesture.
    @State private var gestureScale: CGFloat = 1
    /// Committed pan offset — what survives between gestures.
    @State private var committedOffset: CGSize = .zero
    /// Live pan delta from the in-flight drag gesture.
    @State private var gestureOffset: CGSize = .zero

    /// Latch so we ignore re-entry into onConfirm if the user double-taps the
    /// Done button before the parent has had a chance to dismiss us.
    @State private var didConfirm: Bool = false

    // MARK: - Body

    var body: some View {
        GeometryReader { proxy in
            let container = proxy.size
            // Crop circle: square inscribed in the container, sized to the
            // shorter side. On iPhone in portrait that's `width`; landscape
            // is `height`; the math just works.
            let circleDiameter = min(container.width, container.height)
            let fit = CropMath.aspectFitSize(imageSize: image.size, containerSize: container)
            let minScale = CropMath.minScaleToCoverCircle(
                fitSize: fit,
                circleDiameter: circleDiameter
            )
            let currentScale = max(minScale, committedScale * gestureScale)
            // Pan offset is fed through `clampOffset` so even mid-drag the
            // user can't physically pull empty space inside the circle. The
            // `.onEnded` handlers also commit clamped values, so the state
            // never "snaps" — what you see during the gesture is what stays.
            let rawOffset = CGSize(
                width: committedOffset.width + gestureOffset.width,
                height: committedOffset.height + gestureOffset.height
            )
            let currentOffset = CropMath.clampOffset(
                rawOffset,
                fitSize: fit,
                scale: currentScale,
                circleDiameter: circleDiameter
            )

            ZStack {
                Color.black.ignoresSafeArea()

                // Image layer: drawn at the aspect-fit size, then scaled and
                // offset by the gestures. Using `.scaleEffect` + `.offset`
                // (rather than mutating a transform) keeps the gesture math
                // simple — `CropMath.cropRectInImage` mirrors this exact
                // composition.
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(width: fit.width, height: fit.height)
                    .scaleEffect(currentScale)
                    .offset(currentOffset)
                    .allowsHitTesting(false)

                // Mask + ring: a black rectangle with a circular punch-out,
                // overlaid on the image so anything outside the circle is
                // dimmed but still partially visible (helps the user line
                // up).
                CircularMaskOverlay(diameter: circleDiameter)
                    .allowsHitTesting(false)

                // Transparent gesture catcher. We attach the gestures to a
                // full-bleed clear color rather than the image so the gesture
                // hit-region doesn't shrink/grow with the image.
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(combinedGesture(minScale: minScale, fit: fit, circleDiameter: circleDiameter, container: container))
                    .accessibilityLabel(Text("photo_crop.hint"))
            }
            .overlay(alignment: .top) {
                topBar(circleDiameter: circleDiameter, fit: fit, container: container)
            }
            .overlay(alignment: .bottom) {
                hint
            }
        }
        // Status bar stays visible but light — black background + light text
        // on the top bar reads cleanly.
        .statusBarHidden(false)
        .preferredColorScheme(.dark)
        .onAppear {
            // If the source image is narrower than the circle at fit-size,
            // we have to bump the initial scale up to the minimum-cover
            // threshold; otherwise the user sees black inside the circle on
            // first paint.
            let container = UIScreen.main.bounds.size
            let circle = min(container.width, container.height)
            let fit = CropMath.aspectFitSize(imageSize: image.size, containerSize: container)
            let min = CropMath.minScaleToCoverCircle(fitSize: fit, circleDiameter: circle)
            if committedScale < min {
                committedScale = min
            }
        }
    }

    // MARK: - Sub-views

    /// Vertical hint string above the home indicator. Localized; quiet
    /// styling so it doesn't fight the image.
    private var hint: some View {
        Text("photo_crop.hint")
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(.white.opacity(0.7))
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(.black.opacity(0.35), in: Capsule())
            .padding(.bottom, 24)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private func topBar(circleDiameter: CGFloat, fit: CGSize, container: CGSize) -> some View {
        HStack {
            Button {
                onCancel()
            } label: {
                Text("common.cancel")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.black.opacity(0.35), in: Capsule())
            }
            .accessibilityLabel(Text("common.cancel"))

            Spacer()

            Text("photo_crop.title")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(.black.opacity(0.35), in: Capsule())

            Spacer()

            Button {
                confirm(circleDiameter: circleDiameter, fit: fit, container: container)
            } label: {
                Text("photo_crop.action.confirm")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(.white, in: Capsule())
            }
            .accessibilityLabel(Text("photo_crop.action.confirm"))
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }

    // MARK: - Gestures

    /// Composite gesture = magnification + drag, both active simultaneously.
    ///
    /// Why `SimultaneousGesture` and not the `.simultaneously(with:)`
    /// modifier-chain: the modifier form often degrades to "winner takes all"
    /// on iPad when two fingers are involved. The explicit
    /// `SimultaneousGesture` value type preserves both gestures' values for
    /// the duration of the touch sequence, which is exactly what pinch+pan
    /// needs.
    ///
    /// Why feed clamping back into `committedOffset` on .ended: if the user
    /// shrinks the image past `minScale` mid-pinch we don't want a "snap" at
    /// release — we commit the *clamped* values so the rendered state
    /// matches what's been on screen.
    private func combinedGesture(
        minScale: CGFloat,
        fit: CGSize,
        circleDiameter: CGFloat,
        container: CGSize
    ) -> some Gesture {
        let drag = DragGesture(minimumDistance: 0)
            .onChanged { value in
                gestureOffset = value.translation
            }
            .onEnded { value in
                // Fold the live delta into the committed offset, then clamp
                // so the next gesture starts from a valid position.
                let combined = CGSize(
                    width: committedOffset.width + value.translation.width,
                    height: committedOffset.height + value.translation.height
                )
                let scale = max(minScale, committedScale)
                committedOffset = CropMath.clampOffset(
                    combined,
                    fitSize: fit,
                    scale: scale,
                    circleDiameter: circleDiameter
                )
                gestureOffset = .zero
            }

        let zoom = MagnificationGesture()
            .onChanged { value in
                gestureScale = value
            }
            .onEnded { value in
                // Clamp scale between minimum-cover and 5x (avatars don't
                // benefit from 10x zoom — keeps the gesture predictable).
                let folded = committedScale * value
                let clamped = min(5, max(minScale, folded))
                committedScale = clamped
                gestureScale = 1
                // Re-clamp offset against the new scale.
                committedOffset = CropMath.clampOffset(
                    committedOffset,
                    fitSize: fit,
                    scale: clamped,
                    circleDiameter: circleDiameter
                )
            }

        return SimultaneousGesture(zoom, drag)
    }

    // MARK: - Confirm

    /// Compute the crop rect from current gesture state, render the output
    /// image on the main thread (renderer is cheap at 800x800), and ship it.
    private func confirm(circleDiameter: CGFloat, fit: CGSize, container: CGSize) {
        guard !didConfirm else { return }
        didConfirm = true

        let scale = max(1, committedScale)
        let rect = CropMath.cropRectInImage(
            imageSize: image.size,
            fitSize: fit,
            displayScale: scale,
            offset: committedOffset,
            containerSize: container,
            circleDiameter: circleDiameter
        )
        let cropped = CropMath.renderCrop(
            from: image,
            cropRectInImagePixels: rect,
            outputSize: outputSize
        )
        // Spring on the way out: a touch of springiness on the Done tap
        // (vs. linear or instant) gives the screen a "committed" feel and
        // covers any small delay before the parent dismisses us.
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
            onConfirm(cropped)
        }
    }
}

// MARK: - Mask overlay

/// Dark mask with a circular cutout. SwiftUI's `.mask` flips the alpha, so we
/// build the punch-out with `Rectangle().overlay(Circle().blendMode(.destinationOut))`.
private struct CircularMaskOverlay: View {
    let diameter: CGFloat

    var body: some View {
        ZStack {
            // The dark overlay outside the circle. Heavy enough that the
            // user clearly sees the active region but light enough that they
            // can still recognise what's there (helps for "is this person
            // centered?").
            Rectangle()
                .fill(Color.black.opacity(0.55))
                .overlay {
                    Circle()
                        .frame(width: diameter, height: diameter)
                        .blendMode(.destinationOut)
                }
                .compositingGroup()

            // Thin white ring on the circle edge so it reads as a deliberate
            // crop preview rather than a mistake.
            Circle()
                .strokeBorder(Color.white.opacity(0.85), lineWidth: 1.5)
                .frame(width: diameter, height: diameter)
        }
        .ignoresSafeArea()
    }
}
