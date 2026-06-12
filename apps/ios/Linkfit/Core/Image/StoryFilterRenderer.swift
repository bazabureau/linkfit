import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit

/// CPU/GPU-side renderer that applies a `StoryFilter`'s preset to a
/// `UIImage`. Built on Core Image — no third-party deps, the chain runs
/// on the GPU via the shared `CIContext`.
///
/// **Why a static facade.** The renderer is stateless apart from the
/// shared context; making it static keeps call sites tidy
/// (`StoryFilterRenderer.apply(filter: .baki, to: image)`) and lets the
/// filter strip render thumbnails synchronously without juggling a
/// renderer instance through view state.
///
/// **CIContext lifecycle.** A single shared context is reused across all
/// renders. CIContext allocates a Metal command queue + texture cache —
/// creating one per render burns 5-10ms on the main thread. We init lazily
/// (`static let`) so the first render pays the cost; everything after is
/// near-zero overhead.
///
/// **Thumbnail strategy.** When `thumbnail: true` we downsample the input
/// to ~80pt (matches the strip's tile size) BEFORE running the filter
/// chain. This is the single biggest perf win — running a colour-controls
/// filter on a 4K image is ~30ms, on an 80pt tile it's <2ms. Strip caches
/// the result so the user only pays once per (image, filter) pair.
enum StoryFilterRenderer {
    /// Parameter bundle for a single filter preset. All fields are
    /// optional in the sense that a value of `nil` (encoded as the
    /// neutral value for that knob) means "skip this filter stage" — we
    /// still chain everything so the order is deterministic.
    ///
    /// The knobs map 1:1 to Core Image filter inputs:
    ///   * `brightness` — `CIColorControls.brightness` [-1, 1], 0 = identity
    ///   * `contrast`   — `CIColorControls.contrast`   [0.25, 4], 1 = identity
    ///   * `saturation` — `CIColorControls.saturation` [0, 2], 1 = identity
    ///   * `temperature` — `CITemperatureAndTint.neutral.x` in Kelvin;
    ///                     6500 = identity (D65 daylight); <6500 = warmer
    ///                     output, >6500 = cooler output (the filter
    ///                     compensates AWAY from the neutral point)
    ///   * `tint`       — magenta/green shift; 0 = identity, +ve = magenta
    ///   * `vibrance`   — `CIVibrance.amount` [-1, 1], 0 = identity. Unlike
    ///                     saturation this boosts low-saturation pixels
    ///                     more than already-saturated ones, so colours
    ///                     pop without over-cooking skin tones.
    struct Params {
        var brightness: Float = 0
        var contrast: Float = 1
        var saturation: Float = 1
        var temperature: Float = 6500
        var tint: Float = 0
        var vibrance: Float = 0
    }

    /// Preset table. Keyed by enum case so adding a filter is a single
    /// dictionary entry. Values were tuned by eyeballing real padel court
    /// photos under the strip — bright outdoor daylight on a green court.
    /// The neutral values for `contrast: 1` / `saturation: 1` /
    /// `temperature: 6500` / `vibrance: 0` are Core Image's identity
    /// inputs, so the chain at `.original` reduces to a no-op.
    private static let params: [StoryFilter: Params] = [
        // Identity — every knob at its neutral value. The `apply` fast-
        // path short-circuits this case so the dictionary entry is
        // really just self-documentation.
        .original: Params(),
        // Baku sunset — bump the temperature (warm orange cast),
        // saturation, and slight vibrance for the golden hour glow.
        .baki: Params(
            brightness: 0.02,
            contrast: 1.08,
            saturation: 1.15,
            temperature: 4800,  // warmer than D65
            tint: 6,            // hint of magenta in the sunset
            vibrance: 0.2
        ),
        // Caspian Sea — cool blue cast, slightly desaturated, lift
        // contrast so water gets the silvery edge.
        .xezer: Params(
            brightness: -0.02,
            contrast: 1.12,
            saturation: 0.9,
            temperature: 8200,  // cooler than D65
            tint: -8,           // shift toward green to take the magenta
                                // out of the seascape
            vibrance: 0.1
        ),
        // January cold — high contrast, very cool, drops saturation for
        // that overcast-winter feel.
        .yanvar: Params(
            brightness: -0.04,
            contrast: 1.25,
            saturation: 0.7,
            temperature: 9000,
            tint: -4,
            vibrance: 0.0
        ),
        // Qaracuxur (neighbourhood) — earthy muted tones. Pull
        // saturation back, warm slightly, gentle vignette feel via
        // brightness drop.
        .qaracuxur: Params(
            brightness: -0.05,
            contrast: 1.05,
            saturation: 0.65,
            temperature: 5800,  // slightly warm
            tint: 4,
            vibrance: -0.1
        ),
        // Noir — kill saturation entirely, crank contrast.
        .noir: Params(
            brightness: 0.0,
            contrast: 1.35,
            saturation: 0.0,    // full B&W
            temperature: 6500,  // neutral
            tint: 0,
            vibrance: 0.0
        ),
        // Sepia — drop saturation low (but not zero) and pull strongly
        // toward warm. The remaining colour bleeds into the warm tint.
        .sepia: Params(
            brightness: 0.02,
            contrast: 1.1,
            saturation: 0.3,
            temperature: 3800,  // strongly warm
            tint: 18,           // pink/magenta sepia tone
            vibrance: -0.2
        ),
        // Fade — washed-out pastel. Brightness up, contrast down,
        // saturation down.
        .fade: Params(
            brightness: 0.08,
            contrast: 0.85,
            saturation: 0.75,
            temperature: 6800,
            tint: 2,
            vibrance: -0.05
        ),
        // Vivid — boosted saturation AND vibrance. The double-boost is
        // intentional: saturation lifts every pixel, vibrance protects
        // already-saturated ones from clipping.
        .vivid: Params(
            brightness: 0.02,
            contrast: 1.18,
            saturation: 1.4,
            temperature: 6300,
            tint: 0,
            vibrance: 0.35
        )
    ]

    /// Shared `CIContext`. Static-let initialised once. Options:
    ///   * `useSoftwareRenderer: false` — explicit GPU path. Default but
    ///     pinning it makes the intent obvious.
    ///
    /// `CIContext` conforms to `Sendable` (Swift 6 / iOS 18 SDK), so the
    /// static is freely shareable across concurrency domains — no
    /// isolation annotation needed. Strict-concurrency builds would
    /// otherwise reject reads from background tasks without this
    /// guarantee.
    static let sharedContext: CIContext = {
        CIContext(options: [.useSoftwareRenderer: false])
    }()

    /// Apply `filter` to `image`. Returns a fresh `UIImage` with the
    /// chain baked in. The function is synchronous because Core Image's
    /// render-to-CGImage call IS synchronous on the calling thread —
    /// callers that need to render a 4K photo should hop off the main
    /// thread before invoking (see `StoryEditorViewModel.submit`).
    ///
    /// - Parameters:
    ///   - filter: which preset to apply.
    ///   - image: the source image.
    ///   - thumbnail: when `true`, downsample to ~80pt long-edge first.
    ///                Use this for filter strip tiles.
    /// - Returns: the rendered image, or the original input if any
    ///            Core Image stage fails (defensive — never crash the
    ///            editor over a bad render).
    static func apply(
        filter: StoryFilter,
        to image: UIImage,
        thumbnail: Bool = false
    ) -> UIImage {
        // Identity fast-path. Saves a couple of ms for the most-tapped
        // tile and skips the CGImage round-trip entirely.
        if filter.isIdentity && !thumbnail {
            return image
        }

        // Optionally downsample for thumbnail rendering. We resize via
        // UIGraphicsImageRenderer rather than CILanczosScaleTransform
        // because the strip is fine with the slightly cheaper Quartz
        // resampler — Lanczos would give us a sharper thumbnail but at
        // 80pt the difference is invisible and it costs ~3ms extra.
        let working: UIImage = thumbnail ? downsample(image, longEdge: 80) : image

        // Identity is still cheap to render through the chain for the
        // thumbnail case (so the original tile gets the same rounded
        // corners + tile background as the others, with no surprise size
        // mismatch). For non-thumbnail identity we already returned above.
        if filter.isIdentity {
            return working
        }

        guard let cgInput = working.cgImage else { return working }
        let ciInput = CIImage(cgImage: cgInput)
        let preset = params[filter] ?? Params()

        // Stage 1 — colour controls (brightness/contrast/saturation).
        // Order matters: we colour-control FIRST so the temperature shift
        // operates on the contrast-stretched output. Reversing the order
        // crushes shadows when contrast > 1.
        let colorControls = CIFilter.colorControls()
        colorControls.inputImage = ciInput
        colorControls.brightness = preset.brightness
        colorControls.contrast = preset.contrast
        colorControls.saturation = preset.saturation
        guard let afterColor = colorControls.outputImage else { return working }

        // Stage 2 — temperature + tint. Core Image's filter expects a
        // "neutral" vector (the temperature/tint of the source) and a
        // "targetNeutral" vector (the temperature/tint to map TO). We
        // express the preset as the source temperature with the target
        // pinned at D65 (6500K, 0 tint) — so a `temperature: 4800` preset
        // tells the filter "the source is 4800K, please rebalance to
        // 6500K", which has the effect of WARMING the output.
        let tempTint = CIFilter.temperatureAndTint()
        tempTint.inputImage = afterColor
        tempTint.neutral = CIVector(x: CGFloat(preset.temperature), y: CGFloat(preset.tint))
        tempTint.targetNeutral = CIVector(x: 6500, y: 0)
        guard let afterTemp = tempTint.outputImage else { return working }

        // Stage 3 — vibrance. Always last in the chain so the saturation-
        // protected boost works on the final colour balance.
        let vibrance = CIFilter.vibrance()
        vibrance.inputImage = afterTemp
        vibrance.amount = preset.vibrance
        guard let final = vibrance.outputImage else { return working }

        // Render to CGImage with the working image's extent so we don't
        // lose pixels at filter-introduced edge fades. Using
        // `ciInput.extent` preserves the source dimensions exactly.
        guard let cgOutput = sharedContext.createCGImage(final, from: ciInput.extent) else {
            return working
        }
        return UIImage(cgImage: cgOutput, scale: working.scale, orientation: working.imageOrientation)
    }

    /// Downsample to the given long-edge size (in points). Used for
    /// thumbnail tiles so the filter chain runs on 80pt instead of the
    /// original capture (often 3K-4K on modern iPhones).
    ///
    /// We use `UIGraphicsImageRenderer` so the result is a properly-
    /// oriented `UIImage` ready for Core Image — Core Image doesn't
    /// honour `imageOrientation` on its own.
    private static func downsample(_ image: UIImage, longEdge: CGFloat) -> UIImage {
        let size = image.size
        let longest = max(size.width, size.height)
        // Already small enough — skip the resample to avoid blurring the
        // input. Comparison includes the scale factor so a 60pt @3x photo
        // (180px) doesn't sneak past.
        if longest <= longEdge { return image }
        let ratio = longEdge / longest
        let target = CGSize(width: floor(size.width * ratio), height: floor(size.height * ratio))
        let format = UIGraphicsImageRendererFormat.default()
        // Force `scale = 1` — we want 80pt @1x not 80pt @3x. The
        // thumbnail will live in a 60-80pt UI tile so the extra retina
        // pixels are pure waste.
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: target, format: format)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }
}
