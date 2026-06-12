import SwiftUI

/// "Inbox" tab shell. Holds Notifications and Messages side-by-side via a
/// segmented picker.
struct InboxShell: View {
    enum Sub: Hashable { case notifications, messages }

    @State private var sub: Sub = .notifications
    let apiClient: APIClient
    let onOpenConversation: (ConversationSummary) -> Void

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            VStack(spacing: DSSpacing.sm) {
                picker
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.top, DSSpacing.sm)

                Group {
                    switch sub {
                    case .notifications:
                        NotificationsView(viewModel: NotificationsViewModel(apiClient: apiClient))
                    case .messages:
                        ConversationsView(viewModel: ConversationsViewModel(apiClient: apiClient),
                                          onOpen: onOpenConversation)
                    }
                }
                .transition(.opacity)
            }
        }
    }

    private var picker: some View {
        SegmentedPicker(
            segments: [
                (Sub.notifications, String(localized: "inbox.sub.notifications" as String.LocalizationValue), Optional("bell.fill")),
                (Sub.messages,      String(localized: "inbox.sub.messages" as String.LocalizationValue),     Optional("bubble.left.fill")),
            ],
            selection: $sub
        )
    }
}
