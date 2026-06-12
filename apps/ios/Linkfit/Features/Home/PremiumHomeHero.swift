import SwiftUI

/// Greeting block that adapts to the time of day and frames a circular
/// ELO ring beside the salutation. The ring fills based on how far
/// through the next "level" the user has progressed (each level is one
/// full ELO point in the displayed scale: 2.0 → 3.0 → 4.0…).
///
/// Visual story:
///   - Left column: time-aware "Sabahın xeyir, Kamran!" + supporting line.
///   - Right column: 72pt ring drawn in the brand accent, with the
///     numeric ELO inside.
///
/// We do NOT animate the ring on appear — the value is presented at
/// rest. Number tickers are an antipattern when the metric represents a
/// stable identity rather than progress-toward-goal.
struct PremiumHomeHero: View {
    let firstName: String
    let skillLevel: Double
    let skillTitleKey: LocalizedStringKey

    /// Greeting key resolved once on appear. Time-of-day buckets only
    /// change across hour boundaries — for a session that's typically
    /// <10 min, computing once in `.onAppear` is correct and saves
    /// re-running `Calendar.current.component(.hour, from: Date())` on
    /// every render (which happens whenever any ancestor re-evaluates).
    @State private var greetingKey: LocalizedStringKey = "home.greeting.evening"

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(greetingKey)
                    .font(.system(size: 13, weight: .semibold, design: .default))
                    .foregroundStyle(DSColor.textSecondary)

                Text(welcomeLine)
                    .font(.system(size: 24, weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                Text("home.subtitle.ready")
                    .font(.system(size: 14, weight: .regular, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            eloRing
        }
        .padding(.horizontal, 4)
        .onAppear {
            greetingKey = Self.resolveGreetingKey()
        }
    }

    // MARK: - Subviews

    private var eloRing: some View {
        ZStack {
            // Subtle backing disc + glow
            Circle()
                .fill(DSColor.accent.opacity(0.10))
                .frame(width: 80, height: 80)

            // Track
            Circle()
                .stroke(DSColor.border.opacity(0.4), lineWidth: 5)
                .frame(width: 72, height: 72)

            // Filled portion — fraction of the current level
            Circle()
                .trim(from: 0, to: max(0.05, levelFraction))
                .stroke(
                    LinearGradient(
                        colors: [DSColor.accent, DSColor.accent.opacity(0.7)],
                        startPoint: .topTrailing,
                        endPoint: .bottomLeading
                    ),
                    style: StrokeStyle(lineWidth: 5, lineCap: .round)
                )
                .frame(width: 72, height: 72)
                .rotationEffect(.degrees(-90))

            VStack(spacing: 0) {
                Text(String(format: "%.1f", skillLevel))
                    .font(.system(size: 17, weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                    .monospacedDigit()
                Text(skillTitleKey)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(DSColor.textTertiary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("home.stats.skill_voice"))
    }

    // MARK: - Helpers

    private var levelFraction: CGFloat {
        // Each integer step (2.0, 3.0, …) is a full lap. The fractional
        // part fills the ring. 0.0 maps to a tiny "shows the gradient
        // exists" arc rather than a fully empty ring.
        let fractional = skillLevel - floor(skillLevel)
        return CGFloat(fractional)
    }

    private var welcomeLine: String {
        let template = String(localized: "home.welcome_back_format")
        let name = firstName.isEmpty ? String(localized: "home.placeholder.player") : firstName
        return String(format: template, name)
    }

    /// Picks a localization key based on the local hour. Three buckets:
    ///   05–11 → morning, 12–17 → afternoon, 18–04 → evening.
    /// Called once from `.onAppear` and stashed in `@State greetingKey`
    /// — see the type doc for why per-render recomputation is wasted work.
    private static func resolveGreetingKey() -> LocalizedStringKey {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5...11:  return "home.greeting.morning"
        case 12...17: return "home.greeting.afternoon"
        default:      return "home.greeting.evening"
        }
    }
}
