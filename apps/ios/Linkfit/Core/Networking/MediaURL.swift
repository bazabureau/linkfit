import Foundation

/// Resolves server-provided media URLs into URLs the app is actually allowed
/// to load.
///
/// Early Linkfit builds reached the API only at the bare IP
/// `http://142.93.100.82`. Story photos, avatars, and message images uploaded
/// in that era had that absolute origin baked into their DB rows
/// (`media_url = http://142.93.100.82/uploads/...`). The app is now HTTPS-only
/// — `Info.plist` sets `NSAllowsArbitraryLoads = false` with no bare-IP
/// exception — so App Transport Security silently blocks those legacy loads.
/// The image never arrives and the UI dead-ends on a generic "something went
/// wrong" with no way to recover (a retry re-issues the same blocked request).
///
/// The same machine now serves `/uploads/*` over HTTPS behind
/// `https://api.linkfit.az` (verified: a missing file returns 404, i.e. the
/// path is handled and the certificate is valid). So we rewrite any legacy
/// insecure origin to the canonical HTTPS host while preserving the path.
/// Newer uploads already carry the HTTPS origin and pass through untouched, as
/// do `localhost` (dev keeps its own ATS exception), `file://`, and `nil`.
enum MediaURL {
    /// Canonical HTTPS origin that serves uploaded media today.
    private static let canonicalHost = "api.linkfit.az"

    /// Origins that legacy rows may still point at over plain HTTP. Mapped to
    /// `canonicalHost`. Kept as a set so additional retired hosts can be added
    /// without touching the rewrite logic.
    private static let legacyHosts: Set<String> = ["142.93.100.82"]

    /// Normalize a parsed URL, upgrading a legacy insecure origin to the
    /// canonical HTTPS host. Returns the input unchanged when it isn't a
    /// legacy bare-IP HTTP URL.
    static func resolve(_ url: URL?) -> URL? {
        guard let url else { return nil }
        guard var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url
        }
        if comps.scheme?.lowercased() == "http",
           let host = comps.host,
           legacyHosts.contains(host) {
            comps.scheme = "https"
            comps.host = canonicalHost
            comps.port = nil
        }
        return comps.url ?? url
    }

    /// String convenience for call sites that hold a raw `media_url` string.
    /// Returns `nil` for empty/unparseable input.
    static func resolve(_ raw: String?) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        return resolve(URL(string: raw)) ?? URL(string: raw)
    }
}
