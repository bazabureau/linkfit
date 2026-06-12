import SwiftUI

/// Brand-styled toggle for follow / unfollow.
///
/// - Filled green "Follow" when `isFollowing == false`.
/// - Outlined "Following" when `isFollowing == true`.
///
/// The button drives optimistic UI: it flips its visual state immediately on
/// tap, runs `action` (which is expected to perform the network round-trip),
/// and reverts the visual state if `action` throws. The caller owns the
/// authoritative `isFollowing` binding, so when the round-trip ultimately
/// succeeds the caller updates the source of truth and this view stays in
/// sync.
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

    /// Async action invoked after the optimistic flip. If it throws we revert.
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
                }
                Text(titleKey)
                    .font(.system(
                        size == .compact ? .caption : .footnote,
                        design: .rounded,
                        weight: .semibold
                    ))
                    .lineLimit(1)
            }
            .foregroundStyle(isFollowing ? DSColor.textPrimary : DSColor.textOnAccent)
            .padding(.horizontal, size == .compact ? DSSpacing.sm : DSSpacing.md)
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
            .contentShape(Capsule())
            .opacity(isLoading ? 0.85 : 1.0)
        }
        .buttonStyle(.plain)
        .disabled(isLoading)
        .accessibilityLabel(Text(titleKey))
        .accessibilityAddTraits(.isButton)
        .animation(.easeInOut(duration: 0.15), value: isFollowing)
    }

    private func tap() {
        // Optimistic flip — the caller's binding is updated immediately so the
        // entire UI (badge counts, etc.) can react in step with the button.
        let previous = isFollowing
        let next = !previous
        isFollowing = next
        isLoading = true

        Task { @MainActor in
            defer { isLoading = false }
            do {
                try await action(next)
            } catch {
                // Revert on failure. The caller owns showing a toast / error
                // surface; we just put the button back to its prior state.
                isFollowing = previous
            }
        }
    }
}
