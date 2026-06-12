import SwiftUI

/// "My games" tab: the games near the authenticated user, shown as full-bleed
/// vertical photo cards. Cleanly handles all 4 view states.
struct MyGamesView: View {
    @State var viewModel: HomeViewModel
    @Binding var path: NavigationPath

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.lg) {
                    header
                    content
                    Spacer().frame(height: 120)
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.top, DSSpacing.lg)
            }
            .refreshable { await viewModel.load() }
        }
        .task { await viewModel.onAppear() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
            Text("mygames.title")
                .font(.system(size: 32, weight: .heavy, design: .default))
                .foregroundStyle(DSColor.textPrimary)
            Text("mygames.subtitle")
                .font(DSType.footnote)
                .foregroundStyle(DSColor.textSecondary)
        }
        .padding(.top, DSSpacing.sm)
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView(label: String(localized: "mygames.loading"))
                .frame(height: 280)
        case .loaded(let games):
            LazyVStack(spacing: DSSpacing.md) {
                ForEach(games) { game in
                    NavigationLink(value: HomeRoute.game(game.id)) {
                        GameCardLarge(game: game)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.plain)
                }
            }
        case .empty:
            EmptyStateView(
                icon: "calendar.badge.plus",
                title: String(localized: "mygames.empty.title"),
                message: String(localized: "mygames.empty.message")
            )
            .frame(height: 280)
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.load() } }
                .frame(height: 280)
        }
    }
}
