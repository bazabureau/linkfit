import SwiftUI
import Observation

/// Slim top-of-Home announcement banner — the visual surface for
/// `AnnouncementsViewModel` (W10-12). Renders one row pinned above the
/// rest of Home's `LazyVStack` content; collapses to zero height when
/// the VM's `current` is `nil` (no active broadcast OR the user just
/// dismissed and the next-priority refetch hasn't resolved yet) so the
/// LazyVStack slot disappears without any reserved space.
///
/// Composition:
///
///   * Lime accent background (`DSColor.accent`) so the row reads as
///     "branded callout", not "default chrome". Title is bold ink on
///     accent (`DSColor.textOnAccent`), body picks up the same ink at
///     regular weight so the contrast holds in both light and dark.
///   * Optional CTA pill on the right — only renders when `cta_url`
///     resolves to a routable target via `resolveCTA()` (i.e. a
///     `linkfit://` or `http(s)://` URL). Falls back to the AZ default
///     "Bax" when the admin didn't ship a per-locale label.
///   * "X" dismiss button on the far right — always present. The VM's
///     `dismiss()` does the optimistic clear so the slide-up animation
///     fires inside the same frame as the tap.
///
/// Motion:
///   * `.transition(.move(edge: .top).combined(with: .opacity))` so the
///     banner slides down on first appear and slides up on dismiss.
///   * Honors `accessibilityReduceMotion` — the transition collapses to
///     `.identity` when the system flag is set so the user doesn't get
///     a forced animation. The collapse-to-nil path is still atomic.
///
/// Routing:
///   * `linkfit://` CTAs route through `URLDeepLinkRouter.shared.handle`
///     so the destination push lands on the active tab's NavigationPath
///     via HomeView's `consumePendingDeepLink()` — same path Universal
///     Links and push taps already use.
///   * `https://` CTAs hand off to `@Environment(\.openURL)` so the
///     system browser opens. We don't try to in-app webview — that's
///     a separate surface.
struct AnnouncementBanner: View {
    /// Owned by HomeView via `@State`; we read it as `@Bindable` so the
    /// parent's re-bind (`announcements = AnnouncementsViewModel(...)`
    /// inside `.task`) propagates into this view without us holding a
    /// stale reference. Same pattern as `StoriesRail`'s VM binding.
    @Bindable var viewModel: AnnouncementsViewModel
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if let announcement = viewModel.current {
                content(for: announcement)
                    .transition(bannerTransition)
            }
        }
        // Animate insert + remove. The VM's optimistic clear sets
        // `current = nil` in the same frame as the tap, so wrapping the
        // mutation in `withAnimation` (below) is what drives the
        // slide-out — this `.animation` modifier handles the matching
        // insert when a fresh announcement resolves.
        .animation(reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.85),
                   value: viewModel.current?.id)
    }

    // MARK: - Body

    @ViewBuilder
    private func content(for announcement: AnnouncementForUser) -> some View {
        HStack(alignment: .top, spacing: DSSpacing.sm) {
            // Title + optional body stacked. Title is the headline; the
            // body line is the supporting copy. Body is optional —
            // collapses cleanly when the server returned `nil`.
            VStack(alignment: .leading, spacing: 2) {
                Text(announcement.title)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(DSColor.textOnAccent)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)

                if let body = announcement.body, !body.isEmpty {
                    Text(body)
                        .font(.footnote)
                        .foregroundStyle(DSColor.textOnAccent.opacity(0.85))
                        .multilineTextAlignment(.leading)
                        .lineLimit(3)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // Optional CTA chevron pill. Only renders when the VM
            // resolved the URL into a routable intent — admins can
            // ship an announcement with no CTA, in which case the
            // banner stays informational.
            if let intent = viewModel.resolveCTA() {
                ctaButton(label: announcement.cta_label, intent: intent)
            }

            // Dismiss "X" — far-right, always present. The 28pt frame
            // gives the tap target room without inflating the visual
            // glyph; matches the version-soft-update banner pattern.
            //
            // The VM's `dismiss()` does an optimistic local clear
            // (sets `current = nil` synchronously before awaiting the
            // network round-trip), so the slide-up animation kicks in
            // immediately. The `.animation(_:value:)` modifier on the
            // outer `Group` (keyed on `viewModel.current?.id`) drives
            // the transition without us needing a manual
            // `withAnimation` block here — `@Observable` mutations
            // inside an awaited Task naturally participate in the
            // bound `.animation` modifier's transaction.
            Button {
                UISelectionFeedbackGenerator().selectionChanged()
                Task { await viewModel.dismiss() }
            } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(DSColor.textOnAccent)
                    .frame(width: 28, height: 28)
            }
            .accessibilityLabel(Text("announcements.dismiss.a11y"))
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .background(DSColor.accent)
        // Banner reads as a single grouped element to VoiceOver — the
        // dismiss + CTA buttons keep their own labels via accessibility
        // labels on the inner controls.
        .accessibilityElement(children: .contain)
    }

    // MARK: - CTA

    @ViewBuilder
    private func ctaButton(label: String?, intent: AnnouncementsViewModel.CTAIntent) -> some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            switch intent {
            case .deepLink(let url):
                // Stash in the URL router so HomeView's
                // `consumePendingDeepLink` picks it up on the next
                // observation tick and pushes onto the active tab.
                URLDeepLinkRouter.shared.handle(url)
            case .external(let url):
                openURL(url)
            }
        } label: {
            HStack(spacing: 4) {
                Text(ctaLabel(label))
                    .font(.footnote.weight(.heavy))
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .heavy))
            }
            .foregroundStyle(DSColor.accent)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(DSColor.textOnAccent, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    /// Resolve the CTA label: prefer the admin-supplied locale-collapsed
    /// label, fall back to the AZ default "Bax" so the chevron pill
    /// always reads as a verb rather than going wordless.
    private func ctaLabel(_ provided: String?) -> String {
        if let provided, !provided.isEmpty { return provided }
        return NSLocalizedString("announcements.cta.default",
                                 value: "Bax",
                                 comment: "Default CTA label when the announcement has no per-locale label set")
    }

    // MARK: - Motion

    /// Slide-from-top + opacity. Collapses to `.identity` when the user
    /// has reduce-motion enabled so the banner doesn't move at all —
    /// it just appears / disappears with the LazyVStack slot collapse.
    private var bannerTransition: AnyTransition {
        if reduceMotion {
            return .identity
        }
        return .move(edge: .top).combined(with: .opacity)
    }
}

