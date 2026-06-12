import Foundation
import Observation
import SwiftUI
import UIKit

/// Observable model that owns the result of the launch-time
/// `GET /api/v1/app/version` probe.
///
/// Two derived flags drive UI:
///   * `isForceUpdateRequired` — current build is below the server's
///     `min_supported_build` (or `force_update` is true). Surfaces as
///     a `.fullScreenCover` blocker at the root level — the user
///     cannot use the app until they upgrade.
///   * `hasNewerVersion` — current build is below `latest_build` but
///     still above the floor. Surfaces as a dismissible banner above
///     HomeView's content.
///
/// Errors (network unreachable, missing payload, decode failure, etc.)
/// are intentionally swallowed: we'd rather leave the user unblocked
/// than show a confusing modal if the version endpoint is down.
@Observable
@MainActor
final class VersionGateModel {
    /// True while a `check()` call is in flight. Surfaced so callers
    /// can avoid spawning a second concurrent probe if the user
    /// triggers a refresh while the first request is still pending.
    private(set) var isLoading: Bool = false

    /// Drives the root-level `.fullScreenCover`. Mutable so the cover
    /// can bind directly with `$versionGate.isForceUpdateRequired`;
    /// we don't actually expect the user to dismiss it (the blocker
    /// view has no close affordance), but SwiftUI requires a
    /// settable binding.
    var isForceUpdateRequired: Bool = false

    /// True when a newer build exists but the current build is still
    /// above the minimum supported floor — soft prompt territory.
    private(set) var hasNewerVersion: Bool = false

    /// Last decoded payload. Exposed so banner/blocker views can
    /// show release-notes links or version numbers if we want.
    private(set) var latestResponse: AppVersionResponse?

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    /// Current bundle build (`CFBundleVersion`). Parsed once per call
    /// rather than cached so unit tests can mutate `Bundle.main` (we
    /// don't have a test seam today, but the read is cheap).
    private var currentBuild: Int {
        let raw = Bundle.main.infoDictionary?["CFBundleVersion"] as? String
        return Int(raw ?? "") ?? 0
    }

    /// App Store deep link the "Update" CTA opens. Bundle ID is used
    /// as a stable identifier for the lookup; the real numeric App
    /// Store ID will replace the placeholder once the app is
    /// provisioned in App Store Connect.
    ///
    /// TODO: Replace `idTBD` with the real numeric App Store ID
    /// (e.g. `id1234567890`) once App Store Connect issues one.
    /// Until then this URL falls back to the developer's apps page,
    /// which is at least navigable rather than dead.
    var appStoreURL: URL {
        let bundleId = Bundle.main.bundleIdentifier ?? "az.linkfit.app"
        // Apple's `itms-apps://` scheme jumps directly to the App
        // Store app without a Safari bounce — better UX on device.
        // We fall back to the https form via `URL(string:)` if the
        // string is somehow malformed (it won't be).
        if let url = URL(string: "https://apps.apple.com/app/idTBD?bundleId=\(bundleId)") {
            return url
        }
        return URL(string: "https://apps.apple.com/")!
    }

    /// Fire-and-forget probe against the version endpoint. Designed
    /// to be called from a SwiftUI `.task` modifier — the call is a
    /// no-op if a previous probe is still in flight.
    func check() async {
        if isLoading { return }
        isLoading = true
        defer { isLoading = false }

        do {
            let response = try await apiClient.send(Endpoint.appVersion())
            apply(response: response)
        } catch {
            // Swallow — keep the user unblocked when the server is
            // unreachable. The next launch will retry.
        }
    }

    /// Public seam for tests and previews. Real callers should use
    /// `check()`; this lets us drive the gate without a live
    /// `APIClient`.
    func apply(response: AppVersionResponse) {
        self.latestResponse = response
        let build = currentBuild
        let force = response.ios.force_update || build < response.ios.min_supported_build
        let newer = !force && build < response.ios.latest_build
        self.isForceUpdateRequired = force
        self.hasNewerVersion = newer
    }
}

// MARK: - Blocker view (force update)

/// Full-screen takeover shown when the bundle's build is below the
/// server-declared floor. Intentionally has no dismiss affordance —
/// the only way out is to tap "Update" and open the App Store.
struct VersionGateBlocker: View {
    @Environment(\.openURL) private var openURL
    let appStoreURL: URL

    var body: some View {
        ZStack {
            // Match the app's primary background so the blocker
            // doesn't feel like a system-default sheet — it should
            // read as part of the app.
            DSColor.background
                .ignoresSafeArea()

            VStack(spacing: DSSpacing.lg) {
                Spacer()

                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 64, weight: .regular))
                    .foregroundStyle(DSColor.accent)
                    .accessibilityHidden(true)

                VStack(spacing: DSSpacing.sm) {
                    Text("version.force_update.title")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(DSColor.textPrimary)
                        .multilineTextAlignment(.center)

                    Text("version.force_update.message")
                        .font(.body)
                        .foregroundStyle(DSColor.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, DSSpacing.lg)
                }

                Spacer()

                Button {
                    openURL(appStoreURL)
                } label: {
                    Text("version.update.cta")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, DSSpacing.md)
                        .background(DSColor.accent, in: Capsule())
                        .foregroundStyle(DSColor.textOnAccent)
                }
                .padding(.horizontal, DSSpacing.lg)
                .padding(.bottom, DSSpacing.lg)
            }
            .padding(.top, DSSpacing.xl)
        }
        // The system tries to interpret a swipe-down on the cover as
        // a dismiss gesture — disable it so users can't accidentally
        // wipe the gate by reflex. `interactiveDismissDisabled`
        // applies to the presentation modifier itself; we add it
        // here as a belt-and-braces measure since some iOS versions
        // ignore it from the presenter side.
        .interactiveDismissDisabled(true)
    }
}

// MARK: - Soft banner (newer build available)

/// Slim banner shown above HomeView's scroll content when a newer
/// build is available but the current build is still above the
/// floor. The host view owns a `@State` flag so the user only sees
/// the banner once per session — closing it is a session-local
/// decision, not persisted to disk.
struct VersionSoftUpdateBanner: View {
    @Environment(\.openURL) private var openURL
    let appStoreURL: URL
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: "sparkles")
                .foregroundStyle(DSColor.accent)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text("version.soft_update.title")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(DSColor.textPrimary)
            }

            Spacer(minLength: DSSpacing.xs)

            Button {
                openURL(appStoreURL)
            } label: {
                Text("version.soft_update.cta")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(DSColor.textOnAccent)
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.vertical, 6)
                    .background(DSColor.accent, in: Capsule())
            }

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(DSColor.textSecondary)
                    .frame(width: 24, height: 24)
            }
            .accessibilityLabel(Text("common.close"))
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(DSColor.surfaceElevated)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(DSColor.accentMuted, lineWidth: 1)
        )
        .padding(.horizontal, 16)
    }
}
