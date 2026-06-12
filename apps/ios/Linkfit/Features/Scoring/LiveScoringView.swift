import SwiftUI

/// Full-screen padel scoring surface. Two columns (team A left, team B
/// right), a stacked points-game-set readout per side, fat +/- targets,
/// undo bottom-left, finalize top-right.
///
/// Visual hierarchy is deliberately oversized: a host at courtside is
/// probably holding the phone at arm's length under sunlight. The big
/// numbers + lime accent for the leader + glanceable point label is the
/// point of the screen — everything else (avatars, scoreboard, ratings
/// hand-off) lives outside this view.
struct LiveScoringView: View {
    @State var viewModel: LiveScoringViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var confirmFinalize = false
    @State private var setFlashScale: CGFloat = 1
    @State private var setFlashTeam: ScoreTeam? = nil

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            content
            if let team = setFlashTeam {
                setWonBanner(team: team)
                    .transition(.opacity.combined(with: .scale))
            }
        }
        .navigationBarBackButtonHidden(true)
        .toolbar { toolbar }
        .task {
            await viewModel.appear()
        }
        .onDisappear { viewModel.disappear() }
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .active:
                Task { await viewModel.appear() }
            case .background, .inactive:
                viewModel.disappear()
            @unknown default:
                break
            }
        }
        .onChange(of: viewModel.lastCompletedSetIndex) { _, idx in
            guard let idx else { return }
            triggerSetFlash(at: idx)
        }
        .confirmationDialog(
            Text("scoring.finalize.confirm.title"),
            isPresented: $confirmFinalize,
            titleVisibility: .visible,
        ) {
            Button(role: .destructive) {
                Task {
                    await viewModel.finalize()
                }
            } label: { Text("scoring.finalize.confirm.action") }
            Button(role: .cancel) {} label: { Text("common.cancel") }
        } message: {
            Text("scoring.finalize.confirm.message")
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .fontWeight(.semibold)
                    .foregroundStyle(DSColor.textPrimary)
            }
            .accessibilityLabel(Text("common.close"))
        }
        ToolbarItem(placement: .topBarTrailing) {
            if viewModel.canWrite, case .loaded(let s) = viewModel.state, s.status == .in_progress {
                Button {
                    confirmFinalize = true
                } label: {
                    Text("scoring.finalize")
                        .font(.system(size: 14, weight: .bold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Capsule().fill(DSColor.danger.opacity(0.18)))
                        .foregroundStyle(DSColor.danger)
                }
            }
        }
    }

    // MARK: - Content states

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView()
        case .empty:
            startScreen
        case .error(let m):
            ErrorStateView(message: m) {
                Task { await viewModel.reload() }
            }
        case .loaded(let score):
            scoreBoard(score: score)
        }
    }

    /// Pre-start screen. Only the host sees the action button — everyone else
    /// gets a "host hasn't started yet" placeholder so multi-device flows stay
    /// predictable.
    private var startScreen: some View {
        VStack(spacing: 24) {
            Image(systemName: "stopwatch")
                .font(.system(size: 56, weight: .light))
                .foregroundStyle(DSColor.textSecondary)
            Text("scoring.empty.title")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(DSColor.textPrimary)
            Text("scoring.empty.message")
                .font(.system(size: 14))
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            if viewModel.canStart {
                Button {
                    Task { await viewModel.startScoring() }
                } label: {
                    Text("scoring.start")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(DSColor.textOnAccent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(Capsule().fill(DSColor.accent))
                }
                .disabled(viewModel.isMutating)
                .padding(.horizontal, 32)
                .padding(.top, 12)
            }
        }
    }

    // MARK: - Scoreboard

    private func scoreBoard(score: MatchScore) -> some View {
        VStack(spacing: 0) {
            // Sets ribbon — small recap above the two big columns.
            setsRibbon(score: score)
                .padding(.top, 8)
                .padding(.horizontal, 16)
            HStack(spacing: 12) {
                teamColumn(team: .a, score: score)
                Rectangle()
                    .fill(DSColor.border)
                    .frame(width: 1)
                    .padding(.vertical, 24)
                teamColumn(team: .b, score: score)
            }
            footer(score: score)
        }
    }

    /// Recap of completed sets, e.g. "6-4 · 4-6 · 5-5".
    private func setsRibbon(score: MatchScore) -> some View {
        HStack(spacing: 12) {
            ForEach(Array(score.sets.enumerated()), id: \.offset) { idx, s in
                VStack(spacing: 2) {
                    Text("scoring.set.label \(idx + 1)")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(DSColor.textTertiary)
                    HStack(spacing: 6) {
                        Text("\(s.a)")
                            .foregroundStyle(s.a > s.b ? DSColor.accent : DSColor.textSecondary)
                        Text("-")
                            .foregroundStyle(DSColor.textTertiary)
                        Text("\(s.b)")
                            .foregroundStyle(s.b > s.a ? DSColor.accent : DSColor.textSecondary)
                    }
                    .font(.system(size: 14, weight: .bold))
                    if let tb = s.tb {
                        Text("(\(tb.a)-\(tb.b))")
                            .font(.system(size: 9))
                            .foregroundStyle(DSColor.textTertiary)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 10).fill(DSColor.surfaceElevated))
            }
            Spacer()
        }
        .frame(height: 44)
    }

    private func teamColumn(team: ScoreTeam, score: MatchScore) -> some View {
        let userIds = team == .a ? score.team_a_user_ids : score.team_b_user_ids
        let names = userIds.compactMap { id in
            viewModel.participants.first(where: { $0.user_id == id })?.display_name
        }
        let label = names.isEmpty
            ? String(localized: team == .a ? "scoring.team.a" : "scoring.team.b")
            : names.joined(separator: " · ")
        let games = team == .a ? score.current_game_a : score.current_game_b
        let isLeading = (team == .a && score.point_a > score.point_b)
            || (team == .b && score.point_b > score.point_a)
        let isWinner = score.winning_team == team
        return VStack(spacing: 16) {
            Text(label)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(DSColor.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.top, 12)
            Text(score.pointLabel(for: team))
                .font(.system(size: 96, weight: .black, design: .default))
                .foregroundStyle(
                    isWinner ? DSColor.accent
                        : isLeading ? DSColor.textPrimary : DSColor.textSecondary,
                )
                .scaleEffect(setFlashTeam == team ? setFlashScale : 1)
                .animation(UIAccessibility.isReduceMotionEnabled
                               ? nil
                               : .spring(response: 0.4, dampingFraction: 0.6),
                           value: setFlashScale)
            Text("scoring.games \(games)")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(DSColor.textTertiary)
            if viewModel.canWrite && score.status == .in_progress {
                pointButtons(team: team)
                    .padding(.horizontal, 8)
                    .padding(.top, 8)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.top, 8)
    }

    /// Big + button. The - button is implemented globally as "undo" in the
    /// footer — undoing the last point is more honest than per-team minus,
    /// which would let the user invent score states the rules don't allow.
    private func pointButtons(team: ScoreTeam) -> some View {
        Button {
            Task { await viewModel.recordPoint(team) }
        } label: {
            ZStack {
                Circle()
                    .fill(DSColor.accent)
                Image(systemName: "plus")
                    .font(.system(size: 36, weight: .bold))
                    .foregroundStyle(DSColor.textOnAccent)
            }
            .frame(width: 88, height: 88)
            .shadow(color: DSColor.accent.opacity(0.4), radius: 12, x: 0, y: 6)
        }
        .disabled(viewModel.isMutating)
        .accessibilityLabel(
            Text(team == .a ? "scoring.point.team_a" : "scoring.point.team_b"),
        )
    }

    /// Undo bottom-left + status pill bottom-center.
    private func footer(score: MatchScore) -> some View {
        HStack(spacing: 16) {
            if viewModel.canWrite && score.status == .in_progress {
                Button {
                    Task { await viewModel.undoLastPoint() }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.uturn.backward")
                            .font(.system(size: 14, weight: .bold))
                        Text("scoring.undo")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(DSColor.textPrimary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(Capsule().fill(DSColor.surfaceElevated))
                }
                .disabled(viewModel.isMutating)
            }
            Spacer()
            if score.status == .completed {
                Text("scoring.match_complete")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(DSColor.accent)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(DSColor.accentMuted))
            } else if !viewModel.canWrite {
                Text("scoring.spectator")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DSColor.textTertiary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(DSColor.surfaceElevated))
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 24)
        .padding(.top, 12)
    }

    // MARK: - Set-won flash banner

    private func setWonBanner(team: ScoreTeam) -> some View {
        VStack(spacing: 8) {
            Text(team == .a ? "scoring.flash.team_a_set" : "scoring.flash.team_b_set")
                .font(.system(size: 28, weight: .black, design: .default))
                .foregroundStyle(DSColor.textOnAccent)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.vertical, 24)
                .background(RoundedRectangle(cornerRadius: 24).fill(DSColor.accent))
                .shadow(color: DSColor.accent.opacity(0.6), radius: 24, x: 0, y: 12)
        }
    }

    /// Detect which team just won the set, run the spring scale animation,
    /// then dismiss the banner so the scoreboard returns to normal.
    private func triggerSetFlash(at index: Int) {
        guard case .loaded(let s) = viewModel.state,
              index >= 0, index < s.sets.count else { return }
        let row = s.sets[index]
        let team: ScoreTeam = row.a > row.b ? .a : .b
        let reduceMotion = UIAccessibility.isReduceMotionEnabled
        withAnimation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.5)) {
            setFlashTeam = team
            setFlashScale = reduceMotion ? 1 : 1.25
        }
        Task {
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            await MainActor.run {
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.3)) {
                    setFlashTeam = nil
                    setFlashScale = 1
                }
                viewModel.acknowledgeSetFlash()
            }
        }
    }
}
