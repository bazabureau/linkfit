import SwiftUI

/// Top bar of the new home: LinkFit wordmark + tagline on the left, chat
/// bubble (with unread-conversation badge) + circular avatar on the right.
/// Notifications now live in the dedicated bottom tab.
struct HomeBrandHeader: View {
    let firstName: String
    let unreadCount: Int
    let onChatTap: () -> Void
    let onAvatarTap: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: DSSpacing.sm) {
            wordmark
            Spacer()
            chatButton
            avatarButton
        }
        .padding(.horizontal, DSSpacing.lg)
        .padding(.top, DSSpacing.sm)
    }

    // Home top bar — shows the wordmark + a small tagline below. The
    // tagline still lives in localization (linkfit.brand_tagline) so it
    // translates per locale; the logo itself is the same image.
    private var wordmark: some View {
        VStack(alignment: .leading, spacing: 2) {
            LogoWordmark(size: .m)
            Text("linkfit.brand_tagline")
                .font(DSType.caption)
                .foregroundStyle(DSColor.textSecondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("linkfit.brand_tagline"))
        .accessibilityAddTraits(.isHeader)
    }

    private var chatButton: some View {
        Button(action: onChatTap) {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                    .frame(width: 36, height: 36)
                if unreadCount > 0 {
                    Text(unreadCount > 9 ? "9+" : "\(unreadCount)")
                        .font(.system(size: 10, weight: .bold, design: .default))
                        .foregroundStyle(DSColor.inkSurface)
                        .padding(.horizontal, 4)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Capsule().fill(DSColor.accent))
                        .overlay(Capsule().strokeBorder(DSColor.background, lineWidth: 2))
                        .offset(x: 4, y: -4)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("home.messages"))
    }

    private var avatarButton: some View {
        Button(action: onAvatarTap) {
            ZStack {
                Circle()
                    .fill(DSColor.accentMuted)
                    .frame(width: 44, height: 44)
                Text(initials(firstName))
                    .font(.system(.footnote, design: .default, weight: .bold))
                    .foregroundStyle(DSColor.textPrimary)
                Circle()
                    .strokeBorder(DSColor.border, lineWidth: 1)
                    .frame(width: 44, height: 44)
                Circle()
                    .fill(DSColor.accent)
                    .frame(width: 12, height: 12)
                    .overlay(Circle().strokeBorder(DSColor.background, lineWidth: 2))
                    .offset(x: 16, y: 16)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("home.your_profile"))
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        return parts.joined().isEmpty ? "L" : parts.joined()
    }
}
