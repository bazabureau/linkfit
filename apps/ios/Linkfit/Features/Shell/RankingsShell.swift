import SwiftUI

/// Top-level Rankings tab. Hero header + sport switcher + leaderboard rows.
struct RankingsShell: View {
    let apiClient: APIClient
    let onPickPlayer: (String) -> Void

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            VStack(spacing: 0) {
                hero
                RankingsView(viewModel: RankingsViewModel(apiClient: apiClient),
                             onPickPlayer: onPickPlayer)
            }
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
            Spacer(minLength: 0)
            // FAZA 45 §13.1: hero is 28pt heavy default design, no mixing rounded + default.
            Text("play.hero.rankings")
                .font(DSType.heroTitle)
                .foregroundStyle(.white)
            Text("play.hero.rankings.sub")
                .font(DSType.bodyMedium)
                .foregroundStyle(.white.opacity(0.78))
                .lineLimit(2)
            Spacer().frame(height: DSSpacing.md)
        }
        .padding(.horizontal, DSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 140)
        .background(
            LinearGradient(
                colors: [
                    Color(red: 0.04, green: 0.32, blue: 0.20),
                    Color(red: 0.08, green: 0.55, blue: 0.32),
                ],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            .ignoresSafeArea(edges: .top)
        )
        .overlay(alignment: .topTrailing) {
            Image(systemName: "chart.bar.fill")
                .font(.system(size: 84, weight: .bold))
                .foregroundStyle(.white.opacity(0.12))
                .rotationEffect(.degrees(-10))
                .padding(.trailing, DSSpacing.md)
                .padding(.top, DSSpacing.sm)
                .allowsHitTesting(false)
        }
    }
}
