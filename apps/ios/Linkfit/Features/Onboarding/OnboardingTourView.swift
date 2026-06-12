import SwiftUI

/// Four-step activation tour shown once after signup.
///
/// Visual recipe
/// -------------
/// - Full-screen black background — matches the pre-signup `OnboardingView`
///   so the transition from marketing photos into the tour reads as one
///   continuous experience.
/// - Horizontally swipeable `TabView` (page style, dots hidden — we draw
///   our own `ProgressPills` so they sit exactly above the CTA).
/// - Each slide: a 168pt lime-gradient hero circle housing an SF Symbol,
///   28pt heavy headline, 16pt body. Generous vertical breathing room so
///   the slide feels editorial, not utilitarian.
/// - Persistent "Keç" pill in the top-right corner — visible on every slide
///   including the last, because notification permission must be a true
///   opt-in (a user who taps "Keç" should never have the system prompt
///   fire on their behalf).
/// - Bottom CTA capsule (lime). Copy is "Növbəti" on slides 1-3 and
///   "Bildirişlərə icazə ver" on slide 4 — tapping the latter triggers
///   `UNUserNotificationCenter.requestAuthorization` inside the view-model.
///
/// Presentation contract
/// ---------------------
/// The host (`AppShell`) presents this as a `.fullScreenCover` and gates the
/// presentation on `UserDefaults.bool(forKey: "onboarding.tour.completed")`.
/// The view itself doesn't own the cover binding — it signals completion by
/// calling `onFinished`, leaving the host free to mirror that into both the
/// `UserDefaults` flag and the local presentation state.
struct OnboardingTourView: View {
    /// Invoked when the user finishes the tour, taps skip, or grants/denies
    /// notifications on the final slide. The host is expected to dismiss
    /// the cover and mirror the persistent flag.
    var onFinished: () -> Void

    @State private var viewModel = OnboardingTourViewModel()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            // Match `OnboardingView`'s pure white canvas.
            DSColor.background.ignoresSafeArea()

            // Soft lime glow in the top-right — echoes the brand accent
            // without competing with the hero circle.
            RadialGradient(
                colors: [
                    DSColor.accent.opacity(0.18),
                    Color.clear
                ],
                center: .topTrailing,
                startRadius: 12,
                endRadius: 360
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)

            slidePager

            VStack(spacing: 0) {
                topBar
                Spacer(minLength: 0)
                bottomBar
            }
        }
        .onChange(of: viewModel.isComplete) { _, complete in
            if complete { onFinished() }
        }
        .accessibilityAddTraits(.isModal)
    }

    // MARK: - Pager

    /// `TabView` in `.page` style. Dots disabled — we render our own pills
    /// inside the bottom bar so they line up exactly above the CTA.
    private var slidePager: some View {
        TabView(selection: $viewModel.currentIndex) {
            ForEach(viewModel.slides) { slide in
                OnboardingTourSlideView(slide: slide)
                    .tag(slide.id)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.32),
                   value: viewModel.currentIndex)
    }

    // MARK: - Top bar

    /// Skip pill — top-right on every slide. We always show it (even on
    /// slide 4) so the user retains a one-tap exit. Pressing it marks the
    /// tour complete without firing the notification request.
    private var topBar: some View {
        HStack {
            Spacer()

            Button {
                Haptics.soft()
                viewModel.skip()
            } label: {
                Text("onboarding.tour.skip")
                    .font(.system(.subheadline, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary.opacity(0.88))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(
                        Capsule().fill(.ultraThinMaterial)
                    )
                    .overlay(
                        Capsule().strokeBorder(DSColor.border, lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("onboarding.tour.skip"))
        }
        .padding(.horizontal, DSSpacing.lg)
        .padding(.top, DSSpacing.xs)
        .safeAreaPadding(.top, 6)
    }

    // MARK: - Bottom bar

    /// Page dots + primary CTA. The CTA copy + symbol pivots on the final
    /// slide (next → notifications) and the loading state disables interaction
    /// while the system permission sheet is on screen.
    private var bottomBar: some View {
        VStack(spacing: DSSpacing.md) {
            ProgressPills(
                count: viewModel.slides.count,
                active: viewModel.currentIndex,
                spacing: 7,
                height: 5,
                inactiveWidth: 18,
                activeWidth: 40
            )

            PrimaryAuthButton(
                titleKey: viewModel.primaryCTAKey,
                isLoading: viewModel.isRequestingNotifications,
                isEnabled: !viewModel.isRequestingNotifications,
                action: handleCTA
            )
            .accessibilityLabel(Text(viewModel.primaryCTAKey))
        }
        .padding(.horizontal, DSSpacing.lg)
        .padding(.bottom, DSSpacing.sm)
        .safeAreaPadding(.bottom, 10)
        .animation(.easeInOut(duration: 0.22), value: viewModel.isLastSlide)
    }

    // MARK: - Actions

    /// CTA tap. Hops onto a Task because `advance()` is async (the final
    /// slide awaits the system permission sheet).
    private func handleCTA() {
        Task { @MainActor in
            await viewModel.advance()
        }
    }
}

// MARK: - Slide view

/// One slide. Hero circle + headline + body, vertically centered with
/// breathing room above and below so each slide reads as a poster.
private struct OnboardingTourSlideView: View {
    let slide: OnboardingTourSlide

    var body: some View {
        VStack(spacing: DSSpacing.xl) {
            Spacer(minLength: 0)

            heroCircle

            VStack(spacing: DSSpacing.sm) {
                Text(slide.titleKey)
                    // 28pt heavy — matches DSType.heroTitle and the
                    // pre-signup `OnboardingView` headline ladder.
                    .font(DSType.heroTitle)
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .minimumScaleFactor(0.88)
                    .fixedSize(horizontal: false, vertical: true)

                Text(slide.bodyKey)
                    // 16pt body. Using `.system(size:weight:)` rather than
                    // `DSType.body` so the size stays exactly 16pt across
                    // Dynamic Type — the spec calls for a fixed-size body
                    // beneath the heavy headline.
                    .font(.system(size: 16, weight: .regular, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, DSSpacing.lg)
            }
            .padding(.horizontal, DSSpacing.lg)

            Spacer(minLength: 0)

            // Pads the bottom so slide content never overlaps the CTA
            // bar. The bar height plus dots plus padding is ~170pt; we
            // reserve a touch more to leave a comfortable optical gap.
            Color.clear.frame(height: 180)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    /// Lime gradient hero circle housing the SF Symbol. Three stacked layers:
    /// a soft accent wash, a sharp accent gradient (top-leading → bottom-
    /// trailing), and the symbol itself. Mirrors the visual treatment used
    /// on the `PremiumPageHero` surface so the tour feels native to the
    /// rest of the app's hero language.
    private var heroCircle: some View {
        ZStack {
            // Wide outer halo — fades the lime into the black background.
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            DSColor.accent.opacity(0.30),
                            DSColor.accent.opacity(0.0)
                        ],
                        center: .center,
                        startRadius: 60,
                        endRadius: 160
                    )
                )
                .frame(width: 280, height: 280)

            // Main lime gradient disc.
            Circle()
                .fill(
                    LinearGradient(
                        colors: [
                            DSColor.accent,
                            DSColor.accentSoft
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: 168, height: 168)
                .shadow(color: DSColor.accent.opacity(0.45), radius: 28, y: 12)

            // Subtle inner ring for dimensionality.
            Circle()
                .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
                .frame(width: 168, height: 168)

            Image(systemName: slide.icon)
                .font(.system(size: 72, weight: .semibold))
                .foregroundStyle(DSColor.textOnAccent)
                .accessibilityHidden(true)
        }
    }
}
