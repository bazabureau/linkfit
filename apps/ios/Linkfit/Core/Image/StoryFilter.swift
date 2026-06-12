import Foundation

/// Instagram-style photo filter presets for the story editor.
///
/// **Naming.** Each non-identity preset gets an Azerbaijani-themed name so
/// the filter strip reads like a postcard from Baku rather than a generic
/// "Sierra / Lark / Juno" lineup. The `rawValue` is a stable string used
/// both as the dictionary key into `FilterParams` and as the analytics tag
/// — keep it lowercase Latin-only so it round-trips cleanly through the
/// (potential) future wire format.
///
/// **Localisation.** `localizationKey` returns the `stories.filter.<raw>`
/// xcstrings key that the strip looks up via `Text(LocalizedStringKey(...))`
/// — the AZ value is the primary copy, EN/RU are the equivalents. The keys
/// live alphabetically next to `stories.editor.*` in `Localizable.xcstrings`.
///
/// **Adding a preset.** New cases must (1) append to `CaseIterable`'s
/// order (`allCases` drives the strip's button order, original-first is a
/// deliberate UX choice — Instagram does the same), (2) add a `FilterParams`
/// entry in `StoryFilterRenderer.params`, and (3) add three localisations
/// in `Localizable.xcstrings`. The build is warnings-as-errors so a
/// missing renderer entry would be caught by the runtime guard rather than
/// the compiler — we deliberately default unknown cases to identity so the
/// strip never crashes on a missing param.
enum StoryFilter: String, CaseIterable, Identifiable {
    /// No filter — the original photo passes through untouched. Ships
    /// first in `allCases` so it's the leftmost (and default) tile in the
    /// strip.
    case original
    /// Warm orange tint — evokes Baku's sunset over the Caspian.
    case baki
    /// Cool blue cast — the Caspian Sea itself (Xəzər = Caspian).
    case xezer
    /// High-contrast cold processing — January light, the bleak end of
    /// winter. Pairs well with snow photos.
    case yanvar
    /// Muted earthy palette — named after the Qaraçuxur neighbourhood;
    /// dial-back saturation gives photos a vintage-postcard feel.
    case qaracuxur
    /// Black-and-white with boosted contrast. The classic.
    case noir
    /// Sepia-toned vintage warm. Saturation-cut + temperature boost.
    case sepia
    /// Low-saturation pastel — the "faded denim" look.
    case fade
    /// Boosted saturation + vibrance for high-energy shots.
    case vivid

    var id: String { rawValue }

    /// The xcstrings key for the display label under the thumbnail.
    /// Centralised here so the strip view doesn't string-format the key
    /// at every call site (and so a typo would be caught by `localizable.xcstrings`
    /// instead of silently rendering the raw key).
    var localizationKey: String { "stories.filter.\(rawValue)" }

    /// Identity check — short-circuits the renderer for the "Original"
    /// tile so we don't pay the CIFilter cost on the most-used case.
    var isIdentity: Bool { self == .original }
}
