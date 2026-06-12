import SwiftUI

/// Vertical activity feed — events from people the viewer follows, plus
/// their own. Pull to refresh; infinite scroll via per-row onAppear.
///
/// The view is route-agnostic: tapping a card invokes `onTapTarget`. The
/// host (typically the shell view) maps the target enum onto its own
/// navigation stack. See `FeedHook.swift` for the wiring recipe.
struct FeedView: View {
    @State var viewModel: FeedViewModel
    /// Where to send the user when they tap a card. Pass a closure that
    /// translates `FeedCardTarget` into a `NavigationStack` push or sheet.
    var onTapTarget: (FeedCardTarget) -> Void
    /// Optional CTA for the empty state — when the viewer follows nobody,
    /// the empty state surfaces a "Find players" button that routes here.
    var onFindPlayers: (() -> Void)?

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            content
        }
        .navigationTitle(Text("feed.title"))
        .navigationBarTitleDisplayMode(.large)
        .task { await viewModel.onAppear() }
        .refreshable { await viewModel.refresh() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView()
        case .empty:
            emptyState
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.refresh() } }
        case .loaded(let events):
            ScrollView {
                LazyVStack(spacing: DSSpacing.sm) {
                    ForEach(events) { event in
                        FeedEventCard(event: event, onTap: onTapTarget)
                            .onAppear {
                                if event.id == events.last?.id {
                                    Task { await viewModel.loadMore() }
                                }
                            }
                    }
                    if viewModel.isPaging {
                        ProgressView()
                            .controlSize(.regular)
                            .tint(DSColor.accent)
                            .padding(.vertical, DSSpacing.md)
                    }
                    Spacer().frame(height: 80)
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.top, DSSpacing.md)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: DSSpacing.md) {
            EmptyStateView(
                icon: "person.2.wave.2",
                title: String(localized: "feed.empty.title"),
                message: String(localized: "feed.empty.message")
            )
            if let onFindPlayers {
                Button {
                    onFindPlayers()
                } label: {
                    Text("feed.empty.cta")
                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                        .foregroundStyle(DSColor.textOnAccent)
                        .padding(.horizontal, DSSpacing.lg)
                        .padding(.vertical, DSSpacing.sm)
                        .background(Capsule().fill(DSColor.accent))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("feed.empty.cta"))
            }
        }
    }
}
