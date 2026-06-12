import SwiftUI

/// Integration hook for the Insights feature.
///
/// We own the Insights surface in this folder exclusively; ProfileView is
/// off-limits to this agent (file-ownership rule). To wire a "View
/// insights" entry from the profile screen, the Profile agent should:
///
/// 1. Add a `NavigationLink` (or push via the existing nav stack) targeting
///    `InsightsHook.makeView(container:)`. Best placement is the
///    `actionsCard` block in `ProfileView.swift`, right below the existing
///    "Edit profile" row — only when `viewModel.isMe == true`, since the
///    insights endpoint is `me`-scoped.
///
/// 2. Example snippet to drop into ProfileView's `actionsCard`:
///
///        Divider().overlay(DSColor.border)
///        NavigationLink {
///            InsightsHook.makeView(container: viewModel.container)
///        } label: {
///            HStack {
///                Image(systemName: "chart.line.uptrend.xyaxis")
///                    .foregroundStyle(DSColor.accent)
///                Text("insights.entry.profile_row")
///                    .foregroundStyle(DSColor.textPrimary)
///                Spacer()
///                Image(systemName: "chevron.right")
///                    .foregroundStyle(DSColor.textTertiary)
///            }
///            .padding(DSSpacing.md)
///        }
///        .buttonStyle(.plain)
///
/// 3. If the Profile screen isn't wrapped in a `NavigationStack` yet, the
///    Shell agent must wrap the Profile tab so the push works. As of
///    today the tab shell already provides one — confirm with the Shell
///    agent before shipping.
///
/// All Insights views require an authenticated session; the API endpoint
/// `/api/v1/me/insights` returns 401 otherwise. ProfileView only renders
/// the entry row when viewing your own profile, so this is a non-issue
/// in practice.
enum InsightsHook {
    /// Build the insights screen for the currently-authenticated user.
    /// The Profile agent calls this from its row's destination.
    @MainActor
    static func makeView(container: AppContainer) -> some View {
        InsightsView(
            viewModel: InsightsViewModel(
                apiClient: container.apiClient,
                container: container,
            ),
        )
    }
}
