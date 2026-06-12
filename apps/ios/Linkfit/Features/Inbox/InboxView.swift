import SwiftUI

/// Top-level container for the Inbox sheet. Hosts a tab picker switching
/// between the existing Notifications stream and the new Invitations
/// inbox. The container is redesigned to look exceptionally premium
/// and startup-grade, utilizing a smooth sliding active indicator capsule.
struct InboxView: View {
    enum Tab: String, CaseIterable, Identifiable, Hashable {
        case notifications
        case invitations
        var id: String { rawValue }
        var titleKey: String.LocalizationValue {
            switch self {
            case .notifications: return "inbox.tab.notifications"
            case .invitations:   return "inbox.tab.invitations"
            }
        }
        var icon: String {
            switch self {
            case .notifications: return "bell"
            case .invitations:   return "envelope"
            }
        }
    }

    @Binding var selection: Tab
    let notificationsViewModel: NotificationsViewModel
    let invitationsViewModel: InvitationsViewModel
    /// Forwarded from the parent so notification rows still route
    /// through HomeView's existing `routeForNotification` mapper.
    var onSelectNotification: ((AppNotification) -> Void)?
    /// Pending-count badge for the Invitations tab. Populated by the
    /// view-model's first load; updates when the user accepts/declines
    /// rows so the badge zeroes in the same frame.
    var invitationsBadge: Int
    @Namespace private var pickerNamespace

    var body: some View {
        VStack(spacing: 0) {
            tabPicker
            Divider().background(DSColor.border.opacity(0.12))
            content
        }
    }

    private var tabPicker: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases) { tab in
                let isActive = selection == tab
                let showsBadge = tab == .invitations && invitationsBadge > 0
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    withAnimation(.spring(response: 0.30, dampingFraction: 0.78)) {
                        selection = tab
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: isActive ? "\(tab.icon).fill" : tab.icon)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(isActive ? DSColor.accent : DSColor.textSecondary)
                        Text(String(localized: tab.titleKey))
                            .font(.system(size: 13, weight: .heavy))
                            .lineLimit(1)
                            .foregroundStyle(isActive ? DSColor.textPrimary : DSColor.textSecondary)
                        if showsBadge {
                            Text("\(invitationsBadge)")
                                .font(.system(size: 10, weight: .heavy))
                                .foregroundStyle(DSColor.textOnAccent)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Capsule().fill(DSColor.accent))
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 32)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                    .background {
                        if isActive {
                            RoundedRectangle(cornerRadius: 11, style: .continuous)
                                .fill(DSColor.surface)
                                .shadow(color: Color.black.opacity(0.08), radius: 3.5, x: 0, y: 1.5)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                                        .strokeBorder(DSColor.border, lineWidth: 1)
                                )
                                .matchedGeometryEffect(id: "activeTabCapsule", in: pickerNamespace)
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isActive ? .isSelected : [])
            }
        }
        .padding(4)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(DSColor.surfaceElevated)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.3), lineWidth: 1)
        )
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private var content: some View {
        switch selection {
        case .notifications:
            NotificationsView(
                viewModel: notificationsViewModel,
                onSelect: onSelectNotification
            )
        case .invitations:
            InvitationsView(viewModel: invitationsViewModel)
        }
    }
}
