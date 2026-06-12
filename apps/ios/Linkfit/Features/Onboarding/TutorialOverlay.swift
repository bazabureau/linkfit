import SwiftUI

/// Full-screen first-launch tutorial that walks the user through the four
/// core flows: Find games, Discover players, Book a court, Track stats.
///
/// Designed to appear **once** after onboarding completes. The view does
/// not own its presentation; a parent scene must drive `isPresented` via
/// `TutorialState.hasSeenTutorial`. When the user reaches the final card
/// and taps the CTA, the overlay calls `tutorial.markSeen()` and the
/// parent dismisses it.
///
/// ## Wiring (TODO for the host scene)
///
/// We deliberately don't auto-present from `LinkfitApp.swift` here to avoid
/// stomping on other agents touching the root scene. To enable the overlay,
/// add the following to whichever view owns the post-onboarding surface
/// (typically `HomeView` or `RootView`):
///
/// ```swift
/// @State private var tutorial = TutorialState()
///
/// // …in body…
/// .fullScreenCover(isPresented: Binding(
///     get: { !tutorial.hasSeenTutorial },
///     set: { newValue in if !newValue { tutorial.markSeen() } }
/// )) {
///     TutorialOverlay(state: tutorial)
/// }
/// ```
///
/// Alternatively, if a `Bool.invert` binding helper is introduced, the
/// snippet collapses to `.fullScreenCover(isPresented: $tutorial.hasSeenTutorial.invert)`.
struct TutorialOverlay: View {
    /// The shared persistence flag. Injected so callers can use a singleton
    /// or per-scene instance interchangeably.
    var state: TutorialState

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var index = 0

    private let cards = TutorialCard.all

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()

            TabView(selection: $index) {
                ForEach(cards) { card in
                    TutorialCardView(card: card)
                        .tag(card.id)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.32), value: index)

            VStack(spacing: 0) {
                Spacer(minLength: 0)
                bottomBar
            }
        }
    }

    // MARK: - Bottom bar

    private var bottomBar: some View {
        VStack(spacing: 16) {
            ProgressPills(
                count: cards.count,
                active: index,
                spacing: 8,
                height: 5,
                inactiveWidth: 18,
                activeWidth: 40
            )

            PrimaryAuthButton(
                titleKey: isLast ? "tutorial.action.start" : "tutorial.action.next",
                isLoading: false,
                isEnabled: true,
                action: advance
            )
            .accessibilityLabel(isLast ? Text("tutorial.action.start") : Text("tutorial.action.next"))
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 14)
        .safeAreaPadding(.bottom, 10)
    }

    private var isLast: Bool { index == cards.count - 1 }

    // MARK: - Actions

    private func advance() {
        if isLast {
            state.markSeen()
            dismiss()
        } else {
            withAnimation(reduceMotion ? .none : .spring(response: 0.5, dampingFraction: 0.78)) {
                index += 1
            }
            Haptics.soft()
        }
    }
}

// MARK: - Card model

/// One page of the tutorial. Static — content lives in `Localizable.xcstrings`.
///
/// `LocalizedStringKey` isn't `Sendable` under Swift 6 strict concurrency,
/// so the canonical card list is exposed as a **computed** static property
/// (`all`) rather than a stored `static let`. The view materializes it once
/// in its body's `let cards = …` and never mutates it after, so the cost
/// is one allocation per overlay presentation — negligible for a 4-item
/// array, and avoids the Sendable shared-state warning entirely.
private struct TutorialCard: Identifiable {
    let id: Int
    /// SF Symbol shown above the title.
    let icon: String
    let titleKey: LocalizedStringKey
    let bodyKey: LocalizedStringKey
}

extension TutorialCard {
    static var all: [TutorialCard] {
        [
            TutorialCard(
                id: 0,
                icon: "figure.tennis",
                titleKey: "tutorial.card.1.title",
                bodyKey: "tutorial.card.1.body"
            ),
            TutorialCard(
                id: 1,
                icon: "person.2.fill",
                titleKey: "tutorial.card.2.title",
                bodyKey: "tutorial.card.2.body"
            ),
            TutorialCard(
                id: 2,
                icon: "building.2.fill",
                titleKey: "tutorial.card.3.title",
                bodyKey: "tutorial.card.3.body"
            ),
            TutorialCard(
                id: 3,
                icon: "chart.line.uptrend.xyaxis",
                titleKey: "tutorial.card.4.title",
                bodyKey: "tutorial.card.4.body"
            )
        ]
    }
}

// MARK: - Card view

private struct TutorialCardView: View {
    let card: TutorialCard

    var body: some View {
        VStack(spacing: 28) {
            Spacer(minLength: 0)

            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.14))
                    .frame(width: 168, height: 168)

                Circle()
                    .strokeBorder(DSColor.accent.opacity(0.28), lineWidth: 1)
                    .frame(width: 168, height: 168)

                Image(systemName: card.icon)
                    .font(.system(size: 72, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
                    .accessibilityHidden(true)
            }

            VStack(spacing: 12) {
                Text(card.titleKey)
                    .font(DSType.heroTitle)
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                Text(card.bodyKey)
                    .font(DSType.body)
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 12)
            }
            .padding(.horizontal, 24)

            Spacer(minLength: 0)
            // Pad bottom so content clears the fixed CTA + pills below.
            Color.clear.frame(height: 160)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
