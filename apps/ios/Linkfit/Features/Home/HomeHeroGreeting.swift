import SwiftUI

/// Compact greeting block — kicker (time-aware, lime) + heavy display
/// name. Replaces the previous `PremiumHomeHero` which combined this
/// with a 72pt ELO ring on the right. We dropped the ring because:
///
/// 1. The page now has a dedicated `HomePulseStrip` for at-a-glance
///    stats, so an additional numeric anchor here was redundant.
/// 2. Removing the right column gives the greeting full width — the
///    name reads larger and the page feels less crowded at the top.
/// 3. ELO is a vanity metric for newcomers; surfacing it before the
///    user has even played one game is hostile to new-user onboarding.
struct HomeHeroGreeting: View {
    let firstName: String
    /// Driven by the parent `firstName` resolving from `nil`/empty to
    /// the real display name once `container.currentUser` loads. Used
    /// as the `.id` on the greeting Text so SwiftUI treats the
    /// resolved-name version as a new view, triggering the
    /// `.transition(.opacity)` instead of pop-replacing the string
    /// in-place. Without this the greeting jumps from
    /// "Sabahın xeyir, Oyunçu" to "Sabahın xeyir, Kamran" with no
    /// animation — exactly the pop the polish task is fixing.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Time-of-day bucket resolved once on appear. Buckets only change
    /// across hour boundaries, so for a typical <10-min session
    /// computing once is correct and avoids the per-render
    /// `Calendar.current.component(.hour, from: Date())` call that
    /// `greetingLine` previously triggered on every body re-evaluation.
    @State private var greetingBucket: Bucket = .evening

    var body: some View {
        // Single-line greeting, sentence case. The previous design
        // used uppercase + letter-spaced kicker over a heavy name on
        // its own row, which felt "corporate form" rather than
        // friendly. Collapsing to "Sabahın xeyir, Kamran" in one
        // breath is closer to how people actually greet each other.
        Text(greetingLine)
            .font(.system(size: 28, weight: .heavy, design: .default))
            .foregroundStyle(DSColor.textPrimary)
            .lineLimit(2)
            .minimumScaleFactor(0.75)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            // `id(firstName)` flips identity when the resolved name
            // arrives — SwiftUI then animates the swap rather than
            // pop-replacing. `transition(.opacity)` + a 0.35s
            // ease-in-out gives the same subtle cross-fade Apple
            // Sports uses on its team-name resolves.
            .id(firstName)
            .transition(reduceMotion ? .identity : .opacity)
            .animation(
                reduceMotion ? .none : .easeInOut(duration: 0.35),
                value: firstName
            )
            .onAppear {
                greetingBucket = Self.resolveBucket()
            }
    }

    private var greetingLine: String {
        let prefix: String = {
            switch greetingBucket {
            case .morning:   return String(localized: "home.greeting.morning_friendly")
            case .afternoon: return String(localized: "home.greeting.afternoon_friendly")
            case .evening:   return String(localized: "home.greeting.evening_friendly")
            }
        }()
        let name = firstName.isEmpty
            ? String(localized: "home.placeholder.player")
            : firstName
        return "\(prefix), \(name)"
    }

    private enum Bucket { case morning, afternoon, evening }

    /// Resolve the current time-of-day bucket. Called once from
    /// `.onAppear` and stashed in `@State greetingBucket` — see the
    /// state-property doc for why per-render recomputation is wasted.
    private static func resolveBucket() -> Bucket {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5...11:  return .morning
        case 12...17: return .afternoon
        default:      return .evening
        }
    }

}
