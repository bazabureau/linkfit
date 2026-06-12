import SwiftUI

/// Photo-first onboarding flow with fixed native controls layered over the
/// hero artwork.
struct OnboardingView: View {
    var onFinished: () -> Void

    @State private var index = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let pages = OnboardingPage.all

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()

            TabView(selection: $index) {
                ForEach(pages) { page in
                    OnboardingPageView(page: page, isActive: page.id == index)
                        .tag(page.id)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.36), value: index)
            .ignoresSafeArea()

            VStack(spacing: 0) {
                topBar
                Spacer(minLength: 0)
                bottomBar
            }
        }
    }

    // MARK: - Top bar

    // Top bar — language picker on the left, Skip on the right. The
    // logo is intentionally NOT here: at iPhone widths the centered
    // wordmark collided with the picker chip. Onboarding photos already
    // own the brand identity on this screen, so the top bar stays clean
    // and functional.
    private var topBar: some View {
        HStack(spacing: DSSpacing.sm) {
            LanguagePicker()
                .accessibilityLabel(Text("onboard.a11y.change_language"))

            Spacer()

            if index < pages.count - 1 {
                Button(action: finish) {
                    Text("onboard.skip")
                        .font(.system(.subheadline, design: .default, weight: .semibold))
                        .foregroundStyle(DSColor.textPrimary.opacity(0.86))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(
                            Capsule().fill(.ultraThinMaterial)
                        )
                        .overlay(
                            Capsule().strokeBorder(DSColor.border, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("onboard.skip.voice"))
                .transition(.opacity.combined(with: .move(edge: .trailing)))
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .safeAreaPadding(.top, 6)
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: index)
    }

    // MARK: - Bottom bar

    private var bottomBar: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text(currentPage.kickerKey)
                    .font(DSType.badge)
                    .foregroundStyle(DSColor.accent)

                Text(currentPage.headlineKey)
                    .font(DSType.heroTitle)
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.86)
                    .fixedSize(horizontal: false, vertical: true)

                Text(currentPage.subtitleKey)
                    .font(DSType.body)
                    .foregroundStyle(DSColor.textSecondary)
                    .lineSpacing(3)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }

            ProgressPills(
                count: pages.count,
                active: index,
                spacing: 8,
                height: 5,
                inactiveWidth: 18,
                activeWidth: 40
            )
            .frame(maxWidth: .infinity)
            .padding(.top, 2)

            PrimaryAuthButton(
                titleKey: isLast ? "onboard.get_started" : "onboard.next",
                isLoading: false,
                isEnabled: true,
                action: advance
            )
            .accessibilityLabel(Text(isLast ? "onboard.a11y.get_started" : "onboard.a11y.next"))

            if isLast {
                Button(action: finish) {
                    HStack(spacing: 4) {
                        Text("onboard.have_account")
                            .foregroundStyle(DSColor.textSecondary)
                        Text("onboard.sign_in")
                            .foregroundStyle(DSColor.accent)
                            .underline()
                    }
                    .font(.system(.footnote, design: .default, weight: .semibold))
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("onboard.a11y.have_account"))
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 14)
        .safeAreaPadding(.bottom, 10)
        .animation(.easeInOut(duration: 0.25), value: isLast)
    }

    private var currentPage: OnboardingPage {
        pages[min(max(index, 0), pages.count - 1)]
    }

    private var isLast: Bool { index == pages.count - 1 }

    // MARK: - Actions

    private func advance() {
        if isLast {
            finish()
        } else {
            withAnimation(reduceMotion ? .none : .spring(response: 0.5, dampingFraction: 0.78)) {
                index += 1
            }
            Haptics.soft()
        }
    }

    private func finish() {
        Haptics.medium()
        onFinished()
    }
}
