import SwiftUI

/// Top-level container for the Inbox sheet. Hosts a tab picker switching
/// between the existing Notifications stream and the new Invitations
/// inbox. Uses the native iOS segmented control so this sheet follows
/// system tab-switching behavior instead of a custom pill control.
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

    var body: some View {
        VStack(spacing: 0) {
            tabPicker
            Divider().background(DSColor.border.opacity(0.12))
            content
        }
    }

    private var tabPicker: some View {
        NativeInboxSegmentedControl(
            selection: $selection,
            titles: Dictionary(uniqueKeysWithValues: Tab.allCases.map { ($0, title(for: $0)) })
        )
        .frame(height: 34)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func title(for tab: Tab) -> String {
        let title = String(localized: tab.titleKey)
        guard tab == .invitations, invitationsBadge > 0 else { return title }
        return "\(title) (\(invitationsBadge))"
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

private struct NativeInboxSegmentedControl: UIViewRepresentable {
    @Binding var selection: InboxView.Tab
    let titles: [InboxView.Tab: String]

    func makeUIView(context: Context) -> UISegmentedControl {
        let control = UISegmentedControl()
        control.selectedSegmentTintColor = UIColor(DSColor.accent)
        control.backgroundColor = UIColor(DSColor.surfaceElevated)
        control.setTitleTextAttributes(
            [
                .foregroundColor: UIColor(DSColor.textPrimary),
                .font: UIFont.systemFont(ofSize: 13, weight: .semibold)
            ],
            for: .normal
        )
        control.setTitleTextAttributes(
            [
                .foregroundColor: UIColor(DSColor.textOnAccent),
                .font: UIFont.systemFont(ofSize: 13, weight: .semibold)
            ],
            for: .selected
        )
        control.addTarget(
            context.coordinator,
            action: #selector(Coordinator.valueChanged(_:)),
            for: .valueChanged
        )
        return control
    }

    func updateUIView(_ control: UISegmentedControl, context: Context) {
        let tabs = InboxView.Tab.allCases
        if control.numberOfSegments != tabs.count {
            control.removeAllSegments()
            for (index, tab) in tabs.enumerated() {
                control.insertSegment(withTitle: titles[tab], at: index, animated: false)
            }
        } else {
            for (index, tab) in tabs.enumerated() {
                control.setTitle(titles[tab], forSegmentAt: index)
            }
        }

        control.selectedSegmentIndex = tabs.firstIndex(of: selection) ?? 0
        control.selectedSegmentTintColor = UIColor(DSColor.accent)
        control.backgroundColor = UIColor(DSColor.surfaceElevated)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(selection: $selection)
    }

    final class Coordinator: NSObject {
        private var selection: Binding<InboxView.Tab>

        init(selection: Binding<InboxView.Tab>) {
            self.selection = selection
        }

        @MainActor
        @objc
        func valueChanged(_ sender: UISegmentedControl) {
            let tabs = InboxView.Tab.allCases
            guard tabs.indices.contains(sender.selectedSegmentIndex) else { return }
            UISelectionFeedbackGenerator().selectionChanged()
            selection.wrappedValue = tabs[sender.selectedSegmentIndex]
        }
    }
}
