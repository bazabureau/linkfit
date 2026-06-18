import SwiftUI

/// Elegant, Startup-Grade Americano Tournament view for iOS.
/// Implements the complete tournament flow (Create Setup, Live Fixture Scores, and Sponsor Rewards).
/// Complies with strict FAZA 45 design guidelines (sentence case Azerbaijani, no uppercase tracking, SF default typography).
struct AmericanoTournamentView: View {
    @Environment(AppContainer.self) private var container
    @Environment(\.dismiss) private var dismiss

    // MARK: - Navigation States
    @State private var tournamentId: String? = nil
    @State private var tournamentName: String = ""
    @State private var tournamentFormat: String = "solo"
    @State private var status: String = "open"

    // MARK: - Data Models State
    @State private var teams: [AmericanoTeam] = []
    @State private var matches: [AmericanoMatch] = []
    @State private var leaderboard: [AmericanoLeaderboardEntry] = []
    @State private var reward: AmericanoReward? = nil

    // MARK: - Create Form State
    @State private var gameName: String = ""
    @State private var format: String = "solo"
    @State private var playerNameInput: String = ""
    @State private var players: [String] = []
    @State private var selectedCourts: [String] = ["Court 1"]
    @State private var scoringSystem: String = "21"
    
    // MARK: - Active View States
    @State private var activeRound: Int = 1
    @State private var selectedMatchForScore: AmericanoMatch? = nil
    @State private var scoreAInput: String = ""
    @State private var scoreBInput: String = ""
    
    // MARK: - UI States
    @State private var isSubmitting: Bool = false
    @State private var showScoreModal: Bool = false
    @State private var copiedCoupon: Bool = false

    /// Surfaced to the user instead of silently dropping into a local
    /// sandbox when a `requiresAuth` endpoint fails (401 or transient).
    @State private var formError: String? = nil
    /// Per-score-modal validation message (must reach the 21 target, no
    /// negatives, no ties). Cleared whenever the modal re-opens.
    @State private var scoreError: String? = nil
    /// True only when the user is not signed in — drives the sign-in
    /// prompt instead of a generic error.
    @State private var showSignInPrompt: Bool = false
    /// Reset (Sıfırla) is destructive, so it routes through a confirm.
    @State private var showResetConfirm: Bool = false

    var body: some View {
        ZStack {
            AppGlassBackground()
                .ignoresSafeArea()

            if let _ = tournamentId {
                activeTournamentView
            } else {
                setupTournamentView
            }
        }
        .navigationBarBackButtonHidden(true)
        .overlay {
            if showScoreModal {
                scoreRecordingModal
            }
        }
        .confirmationDialog(
            Text("americano.reset.confirm.title"),
            isPresented: $showResetConfirm,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
                resetTournament()
            } label: { Text("americano.reset.confirm.action") }
            Button(role: .cancel) {} label: { Text("common.cancel") }
        } message: {
            Text("americano.reset.confirm.message")
        }
        .alert(
            Text("americano.signin.title"),
            isPresented: $showSignInPrompt
        ) {
            Button { showSignInPrompt = false } label: { Text("common.ok") }
        } message: {
            Text("americano.signin.message")
        }
    }

    // MARK: - 1. SETUP GAME VIEW
    private var setupTournamentView: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Top Bar
                HStack {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(DSColor.textPrimary)
                            .frame(width: 36, height: 36)
                            .background(Circle().fill(DSColor.surfaceElevated))
                            .overlay(Circle().strokeBorder(DSColor.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("common.close"))
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)

                // Header Hero
                PremiumPageHero(
                    icon: "sportscourt.fill",
                    titleKey: "americano.hero.title",
                    subtitleKey: "americano.hero.subtitle",
                    alignment: .center
                )
                .padding(.horizontal, 16)

                // Form section inputs
                VStack(spacing: 20) {
                    // Name field
                    formCard(title: "americano.form.game_name") {
                        TextField("americano.form.friendly_match", text: $gameName)
                            .textFieldStyle(.plain)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(DSColor.textPrimary)
                            .padding(14)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(DSColor.surfaceElevated.opacity(0.4)))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(DSColor.border.opacity(0.3), lineWidth: 1))
                    }

                    // Format Concentric Picker
                    formCard(title: "americano.form.select_format") {
                        HStack(spacing: 4) {
                            Button { format = "solo" } label: {
                                Text("americano.solo")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(format == "solo" ? DSColor.textPrimary : DSColor.textSecondary)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 10)
                                    .background(
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .fill(format == "solo" ? DSColor.accent.opacity(0.15) : .clear)
                                    )
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .strokeBorder(format == "solo" ? DSColor.accent.opacity(0.4) : .clear, lineWidth: 1)
                                    )
                            }
                            .buttonStyle(.plain)

                            Button { format = "team" } label: {
                                Text("americano.team")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(format == "team" ? DSColor.textPrimary : DSColor.textSecondary)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 10)
                                    .background(
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .fill(format == "team" ? DSColor.accent.opacity(0.15) : .clear)
                                    )
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .strokeBorder(format == "team" ? DSColor.accent.opacity(0.4) : .clear, lineWidth: 1)
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(4)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(DSColor.surfaceElevated.opacity(0.3)))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(DSColor.border.opacity(0.2), lineWidth: 1))
                    }

                    // Add player names
                    formCard(title: "americano.form.add_players") {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 8) {
                                TextField("americano.form.player_name_placeholder", text: $playerNameInput)
                                    .textFieldStyle(.plain)
                                    .font(.system(size: 14, weight: .medium))
                                    .padding(12)
                                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(DSColor.surfaceElevated.opacity(0.4)))
                                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(DSColor.border.opacity(0.3), lineWidth: 1))
                                
                                Button {
                                    addPlayer()
                                } label: {
                                    Text("americano.form.add")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundStyle(DSColor.textOnAccent)
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 12)
                                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(DSColor.accent))
                                }
                                .buttonStyle(.plain)
                                .disabled(playerNameInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || players.count >= 12)
                            }

                            if players.count < 4 || players.count > 12 {
                                Text("americano.form.participants_warning")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(DSColor.warning)
                                    .padding(.top, 2)
                            }

                            // Dynamic list grid of added players
                            FlowLayout(spacing: 8) {
                                ForEach(players, id: \.self) { player in
                                    HStack(spacing: 6) {
                                        Text(player)
                                            .font(.system(size: 12, weight: .semibold))
                                            .foregroundStyle(DSColor.textPrimary)
                                        
                                        Button {
                                            players.removeAll { $0 == player }
                                        } label: {
                                            Image(systemName: "xmark")
                                                .font(.system(size: 10, weight: .bold))
                                                .foregroundStyle(DSColor.textSecondary)
                                        }
                                        .buttonStyle(.plain)
                                        .accessibilityLabel(Text("common.remove"))
                                    }
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6)
                                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surfaceElevated.opacity(0.6)))
                                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(DSColor.border.opacity(0.35), lineWidth: 1))
                                }
                            }
                        }
                    }

                    // Courts grid selection
                    formCard(title: "americano.form.select_courts") {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 95, maximum: 120))], spacing: 8) {
                            ForEach(1...9, id: \.self) { num in
                                let courtName = "Court \(num)"
                                let isSelected = selectedCourts.contains(courtName)
                                Button {
                                    toggleCourt(courtName)
                                } label: {
                                    Text("\(Text("americano.court")) \(num)")
                                        .font(.system(size: 12, weight: .bold))
                                        .foregroundStyle(isSelected ? DSColor.accent : DSColor.textSecondary)
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 8)
                                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(isSelected ? DSColor.accent.opacity(0.12) : DSColor.surfaceElevated.opacity(0.4)))
                                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(isSelected ? DSColor.accent.opacity(0.4) : DSColor.border.opacity(0.3), lineWidth: 1))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    // Surfaced API/auth failure (replaces the old silent
                    // local-sandbox fallback on a requiresAuth endpoint).
                    if let formError {
                        errorBanner(formError)
                    }

                    // Start Game Submit Button
                    Button {
                        startGame()
                    } label: {
                        HStack {
                            if isSubmitting {
                                ProgressView()
                                    .tint(DSColor.textOnAccent)
                                    .padding(.trailing, 8)
                            }
                            Text("americano.form.start_game")
                                .font(.system(size: 15, weight: .black))
                                .foregroundStyle(DSColor.textOnAccent)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.accent))
                    }
                    .buttonStyle(.plain)
                    .disabled(players.count < 4 || players.count > 12 || isSubmitting)
                    .padding(.top, 10)
                }
                .padding(.horizontal, 16)

                Spacer().frame(height: 50)
            }
        }
    }

    // MARK: - 2. ACTIVE GAMES & BRACKETS LEADERBOARD
    private var activeTournamentView: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header with back reset trigger
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(tournamentName)
                            .font(.system(size: 22, weight: .black))
                            .foregroundStyle(DSColor.textPrimary)
                        Text("\(Text("americano.label")) • \(Text(formatKey(tournamentFormat)))")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(DSColor.textSecondary)
                    }
                    Spacer()
                    
                    Button {
                        showResetConfirm = true
                    } label: {
                        Text("americano.reset")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(DSColor.danger)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(DSColor.danger.opacity(0.12)))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("americano.reset.confirm.action"))
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)

                // Surfaced score-submit failure (was a silent local update).
                if let formError {
                    errorBanner(formError)
                        .padding(.horizontal, 16)
                }

                // Reward coupon visual — rendered ONLY when it comes from the
                // backend. The local sandbox never fabricates a coupon, so this
                // can no longer show a fake TOPPADEL reward.
                if let reward = reward {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack {
                            Text("americano.sponsor_reward")
                                .font(.system(size: 10, weight: .black))
                                .foregroundStyle(DSColor.textOnAccent)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(DSColor.accent))

                            Spacer()
                        }

                        winnerNameView(for: reward)
                            .font(.system(size: 20, weight: .black))
                            .foregroundStyle(DSColor.textPrimary)
                        
                        Text(reward.prize_name)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(DSColor.textSecondary)
                        
                        HStack {
                            Text(reward.sponsor_coupon_code)
                                .font(.system(size: 16, weight: .black, design: .monospaced))
                                .foregroundStyle(DSColor.accent)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(DSColor.inkSurface))
                            
                            Spacer()
                            
                            Button {
                                copyRewardCode(reward.sponsor_coupon_code)
                            } label: {
                                Text(copiedCoupon ? "americano.copied" : "americano.copy")
                                    .font(.system(size: 12, weight: .black))
                                    .foregroundStyle(DSColor.textOnAccent)
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 8)
                                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(DSColor.accent))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(20)
                    .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(DSColor.accent.opacity(0.08)))
                    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(DSColor.accent.opacity(0.3), lineWidth: 1.5))
                    .padding(.horizontal, 16)
                }

                // Rounds slider navigation
                VStack(alignment: .leading, spacing: 14) {
                    Text("americano.matches")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(DSColor.textPrimary)
                        .padding(.horizontal, 16)

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            let totalRounds = matches.isEmpty ? 0 : Set(matches.map { $0.round_number }).count
                            if totalRounds > 0 {
                                ForEach(1...totalRounds, id: \.self) { round in
                                    Button {
                                        activeRound = round
                                    } label: {
                                        Text("\(round)")
                                            .font(.system(size: 13, weight: .black))
                                            .foregroundStyle(activeRound == round ? DSColor.textOnAccent : DSColor.textSecondary)
                                            .frame(width: 36, height: 36)
                                            .background(Circle().fill(activeRound == round ? DSColor.accent : DSColor.surfaceElevated.opacity(0.4)))
                                            .overlay(Circle().strokeBorder(activeRound == round ? .clear : DSColor.border.opacity(0.2), lineWidth: 1))
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        .padding(.horizontal, 16)
                    }

                    VStack(spacing: 12) {
                        ForEach(matches.filter { $0.round_number == activeRound }) { match in
                            matchRow(match)
                        }
                    }
                    .padding(.horizontal, 16)
                }

                // Leaderboard standings list card
                VStack(alignment: .leading, spacing: 14) {
                    Text("americano.leaderboard")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(DSColor.textPrimary)
                        .padding(.horizontal, 16)

                    VStack(spacing: 8) {
                        ForEach(Array(leaderboard.enumerated()), id: \.element.id) { index, item in
                            let place = index + 1
                            let isGold = place == 1

                            HStack {
                                HStack(spacing: 12) {
                                    rankBadge(place)
                                        .frame(width: 24, alignment: .center)
                                    
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(item.display_name)
                                            .font(.system(size: 14, weight: .bold))
                                            .foregroundStyle(isGold ? DSColor.accent : DSColor.textPrimary)
                                        Text("\(item.wins)\(String(localized: "americano.win_short")) • \(item.draws)\(String(localized: "americano.draw_short")) • \(item.losses)\(String(localized: "americano.loss_short"))")
                                            .font(.system(size: 10, weight: .medium))
                                            .foregroundStyle(DSColor.textSecondary)
                                    }
                                }
                                
                                Spacer()
                                
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text("\(item.score) \(String(localized: "americano.points"))")
                                        .font(.system(size: 14, weight: .black))
                                        .foregroundStyle(DSColor.textPrimary)
                                    Text("\(item.pointsDifference > 0 ? "+" : "")\(item.pointsDifference) \(String(localized: "americano.diff"))")
                                        .font(.system(size: 10, weight: .semibold))
                                        .foregroundStyle(DSColor.textSecondary)
                                }
                            }
                            .padding(14)
                            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(isGold ? DSColor.accent.opacity(0.04) : DSColor.surfaceElevated.opacity(0.2)))
                            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(isGold ? DSColor.accent.opacity(0.3) : DSColor.border.opacity(0.15), lineWidth: 1))
                        }
                    }
                    .padding(.horizontal, 16)
                }

                Spacer().frame(height: 50)
            }
        }
    }

    // MARK: - 3. RECORD SCORE MODAL SHEET overlay
    private var scoreRecordingModal: some View {
        ZStack {
            DSColor.inkSurface.opacity(0.75)
                .ignoresSafeArea()
                .onTapGesture { showScoreModal = false }

            if let match = selectedMatchForScore {
                VStack(spacing: 20) {
                    Text("americano.record")
                        .font(.system(size: 18, weight: .black))
                        .foregroundStyle(DSColor.textPrimary)

                    Text(match.court_name)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(DSColor.textSecondary)

                    HStack(spacing: 16) {
                        // Team A
                        VStack(spacing: 6) {
                            Text(getTeamDisplayName(match.team_a_id))
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(DSColor.textSecondary)
                                .multilineTextAlignment(.center)
                                .frame(height: 36)
                            
                            TextField("0", text: $scoreAInput)
                                .keyboardType(.numberPad)
                                .textFieldStyle(.plain)
                                .font(.system(size: 24, weight: .black, design: .default))
                                .multilineTextAlignment(.center)
                                .padding(12)
                                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(DSColor.surfaceElevated.opacity(0.5)))
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(DSColor.border.opacity(0.3), lineWidth: 1))
                        }
                        
                        Text(":")
                            .font(.system(size: 24, weight: .black))
                            .foregroundStyle(DSColor.textSecondary)
                            .padding(.top, 36)
                        
                        // Team B
                        VStack(spacing: 6) {
                            Text(getTeamDisplayName(match.team_b_id))
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(DSColor.textSecondary)
                                .multilineTextAlignment(.center)
                                .frame(height: 36)
                            
                            TextField("0", text: $scoreBInput)
                                .keyboardType(.numberPad)
                                .textFieldStyle(.plain)
                                .font(.system(size: 24, weight: .black, design: .default))
                                .multilineTextAlignment(.center)
                                .padding(12)
                                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(DSColor.surfaceElevated.opacity(0.5)))
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(DSColor.border.opacity(0.3), lineWidth: 1))
                        }
                    }

                    // Inline validation feedback (one side must reach the
                    // target, no negatives, no ties).
                    if let scoreError {
                        HStack(spacing: 6) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(DSColor.warning)
                            Text(verbatim: scoreError)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(DSColor.textSecondary)
                                .multilineTextAlignment(.leading)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    // Save score actions
                    HStack(spacing: 10) {
                        Button {
                            showScoreModal = false
                        } label: {
                            Text("americano.cancel")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(DSColor.textSecondary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(DSColor.surfaceElevated.opacity(0.6)))
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(DSColor.border.opacity(0.3), lineWidth: 1))
                        }
                        .buttonStyle(.plain)

                        Button {
                            submitScore()
                        } label: {
                            Text("americano.save")
                                .font(.system(size: 13, weight: .black))
                                .foregroundStyle(DSColor.textOnAccent)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(DSColor.accent))
                        }
                        .buttonStyle(.plain)
                        .disabled(scoreAInput.isEmpty || scoreBInput.isEmpty)
                    }
                    .padding(.top, 8)
                }
                .padding(24)
                .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(DSColor.surfaceElevated))
                .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(DSColor.border.opacity(0.5), lineWidth: 1.5))
                .frame(maxWidth: 320)
                .padding(.horizontal, 24)
            }
        }
    }

    /// Rank indicator for the leaderboard — SF Symbol medals tinted with
    /// the medal tokens for the podium, plain number for everyone else.
    @ViewBuilder
    private func rankBadge(_ place: Int) -> some View {
        switch place {
        case 1:
            Image(systemName: "medal.fill")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(DSColor.medalGold)
        case 2:
            Image(systemName: "medal.fill")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(DSColor.medalSilver)
        case 3:
            Image(systemName: "medal.fill")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(DSColor.medalBronze)
        default:
            Text("\(place)")
                .font(.system(size: 14, weight: .black))
                .foregroundStyle(DSColor.textSecondary)
        }
    }

    // MARK: - Form Helper View Builder
    private func formCard<Content: View>(title: LocalizedStringKey, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(DSColor.textSecondary)
                .padding(.leading, 4)
            
            content()
                .padding(16)
                .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(DSColor.surfaceElevated.opacity(0.15)))
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(DSColor.border.opacity(0.3), lineWidth: 1))
        }
    }

    // MARK: - Logic Operations

    private func addPlayer() {
        let name = playerNameInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        if !players.contains(name) {
            players.append(name)
        }
        playerNameInput = ""
    }

    private func toggleCourt(_ court: String) {
        if selectedCourts.contains(court) {
            if selectedCourts.count > 1 {
                selectedCourts.removeAll { $0 == court }
            }
        } else {
            if selectedCourts.count < 9 {
                selectedCourts.append(court)
            }
        }
    }

    private func startGame() {
        guard players.count >= 4 && players.count <= 12 else { return }

        // P0: creating a tournament hits a `requiresAuth` endpoint. Gate it
        // behind a real session instead of silently 401-ing into a local
        // sandbox that the backend never sees.
        guard container.isAuthenticated else {
            showSignInPrompt = true
            return
        }

        formError = nil
        isSubmitting = true

        let tourneyName = gameName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? String(localized: "americano.form.friendly_match")
            : gameName.trimmingCharacters(in: .whitespacesAndNewlines)

        Task {
            do {
                // Post create game to backend API
                let response = try await container.apiClient.send(
                    .createAmericano(
                        name: tourneyName,
                        format: format,
                        players: players,
                        courts: selectedCourts,
                        scoringSystem: scoringSystem
                    )
                )

                // Fetch full details
                let details = try await container.apiClient.send(.getAmericanoDetails(id: response.id))

                await MainActor.run {
                    self.tournamentId = details.tournament.id
                    self.tournamentName = details.tournament.name
                    self.tournamentFormat = details.tournament.format
                    self.status = details.tournament.status
                    self.teams = details.teams
                    self.matches = details.matches
                    self.leaderboard = details.leaderboard
                    self.reward = details.reward
                    self.activeRound = 1
                    self.isSubmitting = false
                    
                    let generator = UINotificationFeedbackGenerator()
                    generator.notificationOccurred(.success)
                }
            } catch {
                await MainActor.run {
                    self.isSubmitting = false
                    // P0: surface the failure instead of dropping into a silent
                    // local sandbox the backend never recorded.
                    self.formError = String(localized: "americano.start_error")
                    UINotificationFeedbackGenerator().notificationOccurred(.error)
                }
            }
        }
    }

    private func openScoreRecord(_ match: AmericanoMatch) {
        selectedMatchForScore = match
        scoreAInput = match.score_a != nil ? "\(match.score_a!)" : ""
        scoreBInput = match.score_b != nil ? "\(match.score_b!)" : ""
        scoreError = nil
        showScoreModal = true
    }

    /// Target the winning side must reach (scoring system, defaults to 21).
    private var scoreTarget: Int { Int(scoringSystem) ?? 21 }

    /// P2: a valid Americano result has non-negative scores, no tie, and the
    /// winning side reaching the configured target. Returns a localized
    /// message when invalid, `nil` when the score may be saved.
    private func scoreValidationError(_ a: Int, _ b: Int) -> String? {
        if a < 0 || b < 0 { return String(localized: "americano.score_negative") }
        if a == b { return String(localized: "americano.score_tie") }
        if max(a, b) != scoreTarget {
            return String(format: String(localized: "americano.score_target_fmt"), scoreTarget)
        }
        return nil
    }

    private func submitScore() {
        guard let match = selectedMatchForScore else { return }
        guard let sA = Int(scoreAInput), let sB = Int(scoreBInput) else {
            scoreError = String(localized: "americano.score_invalid")
            return
        }

        // P2: validate before we hit the network or update any state.
        if let err = scoreValidationError(sA, sB) {
            scoreError = err
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
            return
        }

        // P0: recording a score hits a `requiresAuth` endpoint.
        guard container.isAuthenticated else {
            showScoreModal = false
            showSignInPrompt = true
            return
        }

        scoreError = nil
        showScoreModal = false

        Task {
            do {
                // Post score to Kysely backend
                _ = try await container.apiClient.send(.recordAmericanoMatchScore(matchId: match.id, scoreA: sA, scoreB: sB))
                
                // Fetch refreshed details
                let details = try await container.apiClient.send(.getAmericanoDetails(id: tournamentId!))

                await MainActor.run {
                    self.teams = details.teams
                    self.matches = details.matches
                    self.leaderboard = details.leaderboard
                    self.reward = details.reward
                    self.status = details.tournament.status
                    
                    let generator = UINotificationFeedbackGenerator()
                    generator.notificationOccurred(.success)
                }
            } catch {
                await MainActor.run {
                    // P0: surface the failure instead of silently writing the
                    // score into local memory the backend never recorded.
                    self.formError = String(localized: "americano.score_error")
                    UINotificationFeedbackGenerator().notificationOccurred(.error)
                }
            }
        }
    }

    private func getTeamDisplayName(_ id: String) -> String {
        teams.first(where: { $0.id == id })?.display_name ?? String(localized: "americano.team_fallback")
    }

    /// Winner row for the reward card. Falls back to a localized "Winner"
    /// label when the team can't be resolved (instead of a hardcoded string).
    @ViewBuilder
    private func winnerNameView(for reward: AmericanoReward) -> some View {
        if let name = teams.first(where: { $0.id == reward.winner_team_id })?.display_name {
            Text(verbatim: name)
        } else {
            Text("americano.winner")
        }
    }

    /// Maps a stored format identifier ("solo"/"team") to its localization key.
    private func formatKey(_ format: String) -> LocalizedStringKey {
        format == "team" ? "americano.team" : "americano.solo"
    }

    /// Renders a stored court identifier ("Court N") with a localized label,
    /// keeping the numeric suffix. Falls back to the raw value if unparsable.
    @ViewBuilder
    private func courtLabel(_ courtName: String) -> some View {
        if let num = courtName.split(separator: " ").last.flatMap({ Int($0) }) {
            Text("\(Text("americano.court")) \(num)")
        } else {
            Text(verbatim: courtName)
        }
    }

    /// Inline failure banner — shown instead of silently routing a failed
    /// `requiresAuth` call into a local sandbox.
    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(DSColor.danger)
            Text(verbatim: message)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(DSColor.textPrimary)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.danger.opacity(0.1)))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(DSColor.danger.opacity(0.35), lineWidth: 1))
    }

    private func resetTournament() {
        tournamentId = nil
        tournamentName = ""
        teams = []
        matches = []
        leaderboard = []
        reward = nil
        players = []
        selectedCourts = ["Court 1"]
        gameName = ""
        format = "solo"
    }

    private func copyRewardCode(_ code: String) {
        UIPasteboard.general.string = code
        copiedCoupon = true
        
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.success)
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            self.copiedCoupon = false
        }
    }

    @ViewBuilder
    private func matchRow(_ match: AmericanoMatch) -> some View {
        HStack {
            HStack(spacing: 12) {
                // Court initials logo
                Text(match.court_name.replacingOccurrences(of: "Court ", with: ""))
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(DSColor.textSecondary)
                    .frame(width: 32, height: 32)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(DSColor.surfaceElevated.opacity(0.5)))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(DSColor.border.opacity(0.3), lineWidth: 1))
                
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(getTeamDisplayName(match.team_a_id)) \(Text("americano.vs")) \(getTeamDisplayName(match.team_b_id))")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(DSColor.textPrimary)
                    courtLabel(match.court_name)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(DSColor.textSecondary)
                }
            }
            
            Spacer()

            if match.status == "completed" {
                let scoreA = match.score_a ?? 0
                let scoreB = match.score_b ?? 0
                HStack(spacing: 8) {
                    Text("\(scoreA) : \(scoreB)")
                        .font(.system(size: 13, weight: .black, design: .monospaced))
                        .foregroundStyle(DSColor.accent)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(DSColor.inkSurface))

                    Button {
                        openScoreRecord(match)
                    } label: {
                        Image(systemName: "pencil")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(DSColor.textSecondary)
                            .frame(width: 32, height: 32)
                            .background(Circle().fill(DSColor.surfaceElevated.opacity(0.4)))
                            // Visual stays 32pt; hit area expands to the 44pt
                            // minimum touch target (FAZA 45 / HIG).
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("americano.record"))
                }
            } else {
                Button {
                    openScoreRecord(match)
                } label: {
                    Text("americano.record")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(DSColor.textPrimary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(DSColor.accent.opacity(0.12)))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(DSColor.accent.opacity(0.3), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.surfaceElevated.opacity(0.3)))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(DSColor.border.opacity(0.2), lineWidth: 1))
    }
}

// MARK: - FlowLayout

/// Wrapping HStack — drops chips to the next row when they overflow.
/// Self-contained so the tournament view can render an arbitrary number of
/// behavior tags without a fixed grid.
private struct FlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        var contentWidth: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if rowWidth + size.width > maxWidth && rowWidth > 0 {
                totalHeight += rowHeight + spacing
                contentWidth = max(contentWidth, rowWidth - spacing)
                rowWidth = 0
                rowHeight = 0
            }
            rowWidth += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        totalHeight += rowHeight
        contentWidth = max(contentWidth, rowWidth - spacing)
        return CGSize(width: contentWidth, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX && x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
