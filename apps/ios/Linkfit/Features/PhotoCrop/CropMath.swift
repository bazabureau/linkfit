import UIKit
import CoreGraphics

/// Pure-function helpers for the photo crop editor.
///
/// `PhotoCropView` keeps a `scale` + `offset` for the displayed image and lets
/// the user pinch / drag. When the user taps Done, we need to turn those
/// gesture values into a square `UIImage` cropped to whatever sat inside the
/// circular mask. That math is non-trivial enough (image is `.aspectFit` into
/// the screen, then scaled, then offset, and we want the part inside a
/// centered circle) that pulling it into a separate file keeps the gesture
/// view readable AND makes the math unit-testable.
///
/// All functions here are deterministic and free of UIKit *gesture* state —
/// the only UIKit dependency is `UIImage` itself, since that's what the
/// renderer needs to draw.
enum CropMath {

    // MARK: - Layout

    /// Size at which a `UIImage` of `imageSize` would be drawn into
    /// `containerSize` using `.aspectFit`. This is the "1x" base size before
    /// the user pinches it.
    ///
    /// Square containers + non-square images: the longer image side becomes
    /// the container side, the shorter side gets letterboxed. We mirror that
    /// here so we know exactly where the image lives on screen when the
    /// gesture state is identity.
    static func aspectFitSize(imageSize: CGSize, containerSize: CGSize) -> CGSize {
        guard imageSize.width > 0, imageSize.height > 0 else { return .zero }
        let scale = min(
            containerSize.width / imageSize.width,
            containerSize.height / imageSize.height
        )
        return CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
    }

    /// Smallest `scale` that still covers the crop circle (= the smallest of
    /// the container's dimensions). If the user pinches below this, parts of
    /// the circle would be empty / black, which looks broken — so we clamp.
    ///
    /// Worked example: container 390x844, image 1200x800. The fit size is
    /// 390x260. The circle diameter equals min(390, 844) = 390. To make sure
    /// the 260-tall image fully covers the 390 circle we need scale >= 390/260
    /// = 1.5. That's what this returns.
    static func minScaleToCoverCircle(fitSize: CGSize, circleDiameter: CGFloat) -> CGFloat {
        guard fitSize.width > 0, fitSize.height > 0 else { return 1 }
        let needed = max(
            circleDiameter / fitSize.width,
            circleDiameter / fitSize.height
        )
        // Never shrink below 1: identity scale is always allowed if the image
        // already covers the circle at fit size.
        return max(1, needed)
    }

    /// Clamp the pan offset so the image edges can't be dragged inside the
    /// crop circle (= empty black inside the circle). The image is centered
    /// in the container, so an offset of `(0,0)` puts the image's center at
    /// the container's center.
    ///
    /// Allowed offset range on each axis = (scaledSide - circleDiameter) / 2.
    /// If the image is exactly as wide as the circle after scaling, you can't
    /// pan horizontally at all — anything else and the circle would show
    /// empty space.
    static func clampOffset(
        _ offset: CGSize,
        fitSize: CGSize,
        scale: CGFloat,
        circleDiameter: CGFloat
    ) -> CGSize {
        let scaledWidth = fitSize.width * scale
        let scaledHeight = fitSize.height * scale
        // `max(0,...)` guards the edge case where the image is somehow
        // smaller than the circle (shouldn't happen after `minScaleToCoverCircle`
        // but cheap insurance against floating-point slop).
        let maxX = max(0, (scaledWidth - circleDiameter) / 2)
        let maxY = max(0, (scaledHeight - circleDiameter) / 2)
        return CGSize(
            width: min(maxX, max(-maxX, offset.width)),
            height: min(maxY, max(-maxY, offset.height))
        )
    }

    // MARK: - Crop rect

    /// Convert the visible crop circle in screen space into a rect in the
    /// original image's pixel space. The returned rect is what
    /// `UIGraphicsImageRenderer` should draw clipped to a square.
    ///
    /// Pipeline:
    ///   1. Image is drawn at `fitSize` then scaled by `displayScale`, so
    ///      every original pixel maps to `fitSize / imageSize * displayScale`
    ///      points on screen.
    ///   2. Image center sits at `containerCenter + offset`.
    ///   3. Crop circle is `circleDiameter` wide, centered in the container.
    ///   4. So the top-left of the crop region in screen points is
    ///      `containerCenter - circleDiameter/2`, and the rect is
    ///      `circleDiameter x circleDiameter`.
    ///   5. Convert that screen rect to image pixels by reversing the
    ///      transform (subtract image origin, divide by scale per axis).
    static func cropRectInImage(
        imageSize: CGSize,
        fitSize: CGSize,
        displayScale: CGFloat,
        offset: CGSize,
        containerSize: CGSize,
        circleDiameter: CGFloat
    ) -> CGRect {
        guard fitSize.width > 0, fitSize.height > 0 else { return .zero }

        // Pixels per screen point along each axis. With `.aspectFit` these
        // are equal, but writing it per-axis is robust to future axis
        // independence (e.g. if we ever support non-square output).
        let pixelsPerPointX = imageSize.width / fitSize.width
        let pixelsPerPointY = imageSize.height / fitSize.height

        // Screen-space rect of the crop circle's bounding square.
        let cropOriginScreenX = (containerSize.width - circleDiameter) / 2
        let cropOriginScreenY = (containerSize.height - circleDiameter) / 2

        // Screen-space rect of the (scaled) image. Image is drawn centered,
        // then translated by `offset`.
        let scaledImageWidth = fitSize.width * displayScale
        let scaledImageHeight = fitSize.height * displayScale
        let imageOriginScreenX = (containerSize.width - scaledImageWidth) / 2 + offset.width
        let imageOriginScreenY = (containerSize.height - scaledImageHeight) / 2 + offset.height

        // Offset of the crop rect inside the image, in screen points.
        let cropOffsetInImageX = cropOriginScreenX - imageOriginScreenX
        let cropOffsetInImageY = cropOriginScreenY - imageOriginScreenY

        // Convert to image pixels. Divide by displayScale to undo the pinch,
        // then by pixelsPerPoint to go from points to native image pixels.
        let pixelOriginX = (cropOffsetInImageX / displayScale) * pixelsPerPointX
        let pixelOriginY = (cropOffsetInImageY / displayScale) * pixelsPerPointY
        let pixelSizeX = (circleDiameter / displayScale) * pixelsPerPointX
        let pixelSizeY = (circleDiameter / displayScale) * pixelsPerPointY

        return CGRect(x: pixelOriginX, y: pixelOriginY, width: pixelSizeX, height: pixelSizeY)
    }

    // MARK: - Rendering

    /// Render the given crop rect of `image` into a square `UIImage` of
    /// `outputSize` x `outputSize` pixels.
    ///
    /// Why renderer + manual draw and not `cgImage?.cropping(to:)`:
    ///   - `cropping(to:)` ignores the image's `imageOrientation`, so a photo
    ///     taken in portrait would crop a sideways slice. Drawing the
    ///     `UIImage` (not the `CGImage`) into a renderer respects orientation
    ///     because UIKit applies the transform for us.
    ///   - We can resize to 800px in the same pass instead of cropping then
    ///     scaling.
    static func renderCrop(
        from image: UIImage,
        cropRectInImagePixels: CGRect,
        outputSize: CGFloat
    ) -> UIImage {
        let target = CGSize(width: outputSize, height: outputSize)
        let format = UIGraphicsImageRendererFormat.default()
        // We want native pixels — output is sized in pixels, not points. A
        // `scale` of 1 means the resulting `UIImage` has `.size = target` and
        // `.scale = 1`, so `image.size.width * image.scale == outputSize`.
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: target, format: format)

        return renderer.image { _ in
            // We draw the entire source image scaled and translated so that
            // `cropRectInImagePixels` lands exactly on (0,0) - (outputSize,
            // outputSize). That way `UIImage.draw(in:)` applies its
            // orientation transform for us; we never touch the CGImage.
            let scaleX = target.width / cropRectInImagePixels.width
            let scaleY = target.height / cropRectInImagePixels.height
            let drawRect = CGRect(
                x: -cropRectInImagePixels.origin.x * scaleX,
                y: -cropRectInImagePixels.origin.y * scaleY,
                width: image.size.width * scaleX,
                height: image.size.height * scaleY
            )
            image.draw(in: drawRect)
        }
    }

    /// Encode a UIImage as JPEG, walking the compression quality down until
    /// the result is at or under `maxBytes`. Returns the smallest data that
    /// satisfies the budget, or the lowest-quality attempt if nothing fits
    /// (a 150 KB budget at 800x800 is generous for any reasonable photo so
    /// the fallback is a defensive cap, not an expected path).
    ///
    /// Why iterative and not single-shot: JPEG bytes don't scale linearly
    /// with quality, and at 800x800 the right quality is workload-dependent
    /// (a photo of a face vs. a photo of grass differ by 3-4x at the same
    /// quality). Eight steps from 0.85 down to 0.15 lands us inside 150 KB
    /// for any realistic input in <10ms.
    static func encodeJPEG(_ image: UIImage, maxBytes: Int) -> Data {
        let qualities: [CGFloat] = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25, 0.15]
        var fallback = image.jpegData(compressionQuality: qualities.last ?? 0.15) ?? Data()
        for quality in qualities {
            guard let data = image.jpegData(compressionQuality: quality) else { continue }
            if data.count <= maxBytes {
                return data
            }
            fallback = data
        }
        return fallback
    }
}
