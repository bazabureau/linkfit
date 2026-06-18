import SwiftUI

/// Brand-styled toggle for follow / unfollow.
///
/// - Filled accent "Follow" when `isFollowing == false`.
/// - Outlined "Following" when `isFollowing == true`.
///
/// The caller owns optimistic state and rollback. This button only handles
/// presentation, haptics, and a local loading affordance so follow state has
/// one source of truth.
struct FollowButton: View {
    /// Authoritative follow state, owned by the caller.
    @Binding var isFollowing: Bool

    /// Visual size variants. `.compact` is meant for inline placement inside
    /// list rows; `.regular` for standalone CTAs (profile header, etc).
    enum Size {
        case compact
        case regular
    }
    var size: Size = .compact

    /// Async action invoked with the desired next value.
    var action: (_ newValue: Bool) async throws -> Void

    @State private var isLoading: Bool = false

    private var titleKey: LocalizedStringKey {
        isFollowing ? "players.follow.following" : "players.follow.toggle"
    }

    private var iconName: String {
        isFollowing ? "checkmark" : "plus"
    }

    var body: some View {
        Button {
            tap()
        } label: {
            HStack(spacing: size == .compact ? 4 : DSSpacing.xs) {
                if isLoading {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(isFollowing ? DSColor.textPrimary : DSColor.textOnAccent)
                } else {
                    Image(systemName: iconName)
                        .font(.system(size: size == .compact ? 11 : 13, weight: .bold))
                        .contentTransition(.symbolEffect(.replace))   // plus ↔ checkmark morph
                }
                Text(titleKey)
                    .font(.system(
                        size == .compact ? .caption : .footnote,
                        design: .default,
                        weight: .semibold
                    ))
                    // Drop lineLimit(1): az/ru labels ("İzlənilir" / "Подписки")
                    // are longer than en and were truncating. Allow a small
                    // shrink and let the capsule hug the intrinsic width.
                    .minimumScaleFactor(0.85)
                    .fixedSize(horizontal: true, vertical: false)
            }
            .foregroundStyle(isFollowing ? DSColor.textPrimary : DSColor.textOnAccent)
            .padding(.horizontal, size == .compact ? DSSpacing.sm : DSSpacing.md)
            // Visual capsule keeps its compact 30 / regular 38pt look…
            .frame(height: size == .compact ? 30 : 38)
            .background(
                Capsule().fill(isFollowing ? Color.clear : DSColor.accent)
            )
            .overlay(
                Capsule().strokeBorder(
                    isFollowing ? DSColor.border : Color.clear,
                    lineWidth: 1
                )
            )
            // …but the tap target expands to the HIG-minimum 44pt. The
            // content shape is applied AFTER the min-height frame so the
            // whole 44pt band is hittable, not just the visible capsule.
            .frame(minHeight: 44)
            .contentShape(Capsule())
            .opacity(isLoading ? 0.85 : 1.0)
        }
        .buttonStyle(SpringPressStyle())
        .disabled(isLoading)
        .accessibilityLabel(Text(titleKey))
        .accessibilityAddTraits(.isButton)
        .animation(.easeInOut(duration: 0.15), value: isFollowing)
    }

    private func tap() {
        Haptics.soft()   // gentle social-toggle tick (light tier of the ladder)
        let next = !isFollowing
        isLoading = true

        Task { @MainActor in
            defer { isLoading = false }
            do {
                try await action(next)
            } catch {
                ToastCenter.shared.error(String(localized: "profile.follow.failed"))
            }
        }
    }
}
