import SwiftUI

/// Integration hook for the Streaks feature.
///
/// File ownership rule: this folder is the only place that touches Streaks
/// surfaces, so other agents (Profile, Insights, …) interact with us
/// through `StreaksHook` exclusively.
///
/// Two integration points:
///
/// 1. `makeView(container:userId:)` — full-screen streaks detail. Push
///    via a `NavigationLink` from ProfileView's actions card, e.g.:
///
///        NavigationLink {
///            StreaksHook.makeView(
///                container: viewModel.container,
///                userId: viewModel.userId,
///            )
///        } label: {
///            Label("streaks.entry.profile_row", systemImage: "flame.fill")
///        }
///
/// 2. `makeEmbed(container:userId:)` — compact heatmap card meant to live
///    directly inside ProfileView. It loads its own data, shows a thin
///    KPI line + the heatmap, and degrades gracefully on auth failure.
///    Drop it into the profile scroll like any other section:
///
///        StreaksHook.makeEmbed(container: container, userId: userId)
///
/// Both helpers require the viewer to be signed in (the API is auth-
/// gated). ProfileView's existing auth guard already ensures that for
/// the "my profile" path; for other-user profiles you'll need to wrap.
enum StreaksHook {
    /// Build the full-screen streaks detail view for `userId`. Used as the
    /// destination of a NavigationLink.
    @MainActor
    static func makeView(container: AppContainer, userId: String) -> some View {
        StreaksView(
            viewModel: StreaksViewModel(apiClient: container.apiClient, userId: userId),
        )
    }

    /// Build the compact embed for inline use on the profile screen.
    @MainActor
    static func makeEmbed(container: AppContainer, userId: String) -> some View {
        StreaksEmbed(
            viewModel: StreaksViewModel(apiClient: container.apiClient, userId: userId),
        )
    }
}

/// Compact embed — KPI line + heatmap, no controls. Loads on appear and
/// keeps the failure path silent (a fading caption) so it never blocks the
/// profile content underneath.
struct StreaksEmbed: View {
    @State var viewModel: StreaksViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            HStack(spacing: 8) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
                Text("streaks.embed.title")
                    .font(DSType.cardTitle)
                    .foregroundStyle(DSColor.textPrimary)
                Spacer()
                if case let .loaded(resp) = viewModel.state {
                    Text(String(format: String(localized: "streaks.embed.summary_format"),
                                resp.current_streak_weeks, resp.longest_streak_weeks))
                        .font(DSType.caption)
                        .foregroundStyle(DSColor.textSecondary)
                }
            }
            content
        }
        .padding(DSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface),
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1),
        )
        .task { await viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            // Placeholder strip so the embed has stable height.
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(DSColor.border.opacity(0.2))
                .frame(height: 44)
        case .loaded(let resp):
            StreaksHeatmap(weeks: resp.weeks, cellSize: 14, cellSpacing: 3)
        case .empty, .error:
            Text("streaks.embed.error_caption")
                .font(DSType.caption)
                .foregroundStyle(DSColor.textTertiary)
        }
    }
}
