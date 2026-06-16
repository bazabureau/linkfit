import SwiftUI

/// Elegant, Startup-Grade Americano Tournament view for iOS.
/// Implements the complete tournament flow (Create Setup, Live Fixture Scores, and Sponsor Rewards).
/// Complies with strict FAZA 45 design guidelines (sentence case Azerbaijani, no uppercase tracking, SF default typography).
struct AmericanoTournamentView: View {
    @Environment(AppContainer.self) private var container
    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale

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
                            .background(Circle().fill(.ultraThinMaterial))
                            .overlay(Circle().strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1))
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
                    formCard(title: localizedString("game_name")) {
                        TextField(localizedString("friendly_match"), text: $gameName)
                            .textFieldStyle(.plain)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(DSColor.textPrimary)
                            .padding(14)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(DSColor.surfaceElevated.opacity(0.4)))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(DSColor.border.opacity(0.3), lineWidth: 1))
                    }

                    // Format Concentric Picker
                    formCard(title: localizedString("select_format")) {
                        HStack(spacing: 4) {
                            Button { format = "solo" } label: {
                                Text(localizedString("solo"))
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
                                Text(localizedString("team"))
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
                    formCard(title: localizedString("add_players")) {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 8) {
                                TextField(localizedString("player_name_placeholder"), text: $playerNameInput)
                                    .textFieldStyle(.plain)
                                    .font(.system(size: 14, weight: .medium))
                                    .padding(12)
                                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(DSColor.surfaceElevated.opacity(0.4)))
                                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(DSColor.border.opacity(0.3), lineWidth: 1))
                                
                                Button {
                                    addPlayer()
                                } label: {
                                    Text(localizedString("add"))
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
                                Text(localizedString("participants_warning"))
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
                    formCard(title: localizedString("select_courts")) {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 95, maximum: 120))], spacing: 8) {
                            ForEach(1...9, id: \.self) { num in
                                let courtName = "Court \(num)"
                                let isSelected = selectedCourts.contains(courtName)
                                Button {
                                    toggleCourt(courtName)
                                } label: {
                                    Text(courtName)
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
                            Text(localizedString("start_game"))
                                .font(.system(size: 15, weight: .black))
                                .foregroundStyle(DSColor.textOnAccent)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.accent))
                        .shadow(color: DSColor.accent.opacity(0.4), radius: 10, x: 0, y: 5)
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
                        Text("Americano • \(localizedString(tournamentFormat))")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(DSColor.textSecondary)
                    }
                    Spacer()
                    
                    Button {
                        resetTournament()
                    } label: {
                        Text(localizedString("reset"))
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(DSColor.danger)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(DSColor.danger.opacity(0.12)))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)

                // Reward coupon visual if completed
                if let reward = reward {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack {
                            Text(localizedString("sponsor_reward"))
                                .font(.system(size: 10, weight: .black))
                                .foregroundStyle(DSColor.textOnAccent)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(DSColor.accent))
                            
                            Spacer()
                        }
                        
                        Text(reward.winner_team_id == "" ? "Winner Team" : getWinnerName())
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
                                Text(copiedCoupon ? localizedString("copied") : localizedString("copy"))
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
                    Text(localizedString("matches"))
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
                    Text(localizedString("leaderboard"))
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
                                        Text("\(item.wins)\(localizedString("win_short")) • \(item.draws)\(localizedString("draw_short")) • \(item.losses)\(localizedString("loss_short"))")
                                            .font(.system(size: 10, weight: .medium))
                                            .foregroundStyle(DSColor.textSecondary)
                                    }
                                }
                                
                                Spacer()
                                
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text("\(item.score) \(localizedString("points"))")
                                        .font(.system(size: 14, weight: .black))
                                        .foregroundStyle(DSColor.textPrimary)
                                    Text("\(item.pointsDifference > 0 ? "+" : "")\(item.pointsDifference) \(localizedString("diff"))")
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
            Color.black.opacity(0.75)
                .ignoresSafeArea()
                .onTapGesture { showScoreModal = false }

            if let match = selectedMatchForScore {
                VStack(spacing: 20) {
                    Text(localizedString("record"))
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

                    // Save score actions
                    HStack(spacing: 10) {
                        Button {
                            showScoreModal = false
                        } label: {
                            Text(localizedString("cancel"))
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
                            Text(localizedString("save"))
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
    private func formCard<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
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
        isSubmitting = true

        let tourneyName = gameName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty 
            ? localizedString("friendly_match") 
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
                    // Fallback to local sandbox play in case of transient local network issues
                    startLocalSandboxGame()
                }
            }
        }
    }

    private func startLocalSandboxGame() {
        let id = UUID().uuidString
        let tourneyName = gameName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty 
            ? localizedString("friendly_match") 
            : gameName.trimmingCharacters(in: .whitespacesAndNewlines)
        
        let localTeams = players.map { name in
            AmericanoTeam(
                id: UUID().uuidString,
                tournament_id: id,
                display_name: name,
                wins: 0,
                draws: 0,
                losses: 0,
                score: 0
            )
        }

        // Standard Circle Round Robin fixture generator
        var list = localTeams
        if list.count % 2 != 0 {
            // Add bypass element
            list.append(AmericanoTeam(id: "BYE", tournament_id: id, display_name: "BYE", wins: 0, draws: 0, losses: 0, score: 0))
        }

        let numTeams = list.count
        let numRounds = numTeams - 1
        let half = numTeams / 2
        var localMatches: [AmericanoMatch] = []

        for round in 1...numRounds {
            var roundPairs: [(home: AmericanoTeam, away: AmericanoTeam)] = []
            for i in 0..<half {
                let home = list[i]
                let away = list[numTeams - 1 - i]
                if home.id != "BYE" && away.id != "BYE" {
                    roundPairs.append((home, away))
                }
            }

            for (index, pair) in roundPairs.enumerated() {
                let courtName = selectedCourts[index % selectedCourts.count]
                localMatches.append(
                    AmericanoMatch(
                        id: UUID().uuidString,
                        tournament_id: id,
                        court_name: courtName,
                        round_number: round,
                        team_a_id: pair.home.id,
                        team_b_id: pair.away.id,
                        score_a: nil,
                        score_b: nil,
                        status: "pending"
                    )
                )
            }

            // Rotate list
            list.insert(list.removeLast(), at: 1)
        }

        self.tournamentId = id
        self.tournamentName = tourneyName
        self.tournamentFormat = format
        self.status = "playing"
        self.teams = localTeams
        self.matches = localMatches
        calculateLocalLeaderboard()
    }

    private func openScoreRecord(_ match: AmericanoMatch) {
        selectedMatchForScore = match
        scoreAInput = match.score_a != nil ? "\(match.score_a!)" : ""
        scoreBInput = match.score_b != nil ? "\(match.score_b!)" : ""
        showScoreModal = true
    }

    private func submitScore() {
        guard let match = selectedMatchForScore else { return }
        guard let sA = Int(scoreAInput), let sB = Int(scoreBInput) else { return }

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
                    // Failover: Sandbox mode score updates in local memory
                    let updatedMatches = matches.map { m -> AmericanoMatch in
                        if m.id == match.id {
                            return AmericanoMatch(
                                id: m.id,
                                tournament_id: m.tournament_id,
                                court_name: m.court_name,
                                round_number: m.round_number,
                                team_a_id: m.team_a_id,
                                team_b_id: m.team_b_id,
                                score_a: sA,
                                score_b: sB,
                                status: "completed"
                            )
                        }
                        return m
                    }
                    self.matches = updatedMatches
                    calculateLocalLeaderboard()
                }
            }
        }
    }

    private func calculateLocalLeaderboard() {
        var board: [AmericanoLeaderboardEntry] = teams.map { t in
            AmericanoLeaderboardEntry(
                id: t.id,
                display_name: t.display_name,
                wins: 0,
                draws: 0,
                losses: 0,
                score: 0,
                pointsScored: 0,
                pointsConceded: 0,
                pointsDifference: 0
            )
        }

        for match in matches {
            guard match.status == "completed", let sA = match.score_a, let sB = match.score_b else { continue }

            if let idxA = board.firstIndex(where: { $0.id == match.team_a_id }) {
                var entry = board[idxA]
                entry = AmericanoLeaderboardEntry(
                    id: entry.id,
                    display_name: entry.display_name,
                    wins: entry.wins + (sA > sB ? 1 : 0),
                    draws: entry.draws + (sA == sB ? 1 : 0),
                    losses: entry.losses + (sA < sB ? 1 : 0),
                    score: entry.score + (sA > sB ? 3 : sA == sB ? 1 : 0),
                    pointsScored: entry.pointsScored + sA,
                    pointsConceded: entry.pointsConceded + sB,
                    pointsDifference: entry.pointsDifference + (sA - sB)
                )
                board[idxA] = entry
            }

            if let idxB = board.firstIndex(where: { $0.id == match.team_b_id }) {
                var entry = board[idxB]
                entry = AmericanoLeaderboardEntry(
                    id: entry.id,
                    display_name: entry.display_name,
                    wins: entry.wins + (sB > sA ? 1 : 0),
                    draws: entry.draws + (sB == sA ? 1 : 0),
                    losses: entry.losses + (sB < sA ? 1 : 0),
                    score: entry.score + (sB > sA ? 3 : sB == sA ? 1 : 0),
                    pointsScored: entry.pointsScored + sB,
                    pointsConceded: entry.pointsConceded + sA,
                    pointsDifference: entry.pointsDifference + (sB - sA)
                )
                board[idxB] = entry
            }
        }

        // Sort by Score, then Diff, then Scored
        board.sort { a, b in
            if a.score != b.score { return a.score > b.score }
            if a.pointsDifference != b.pointsDifference { return a.pointsDifference > b.pointsDifference }
            return a.pointsScored > b.pointsScored
        }

        self.leaderboard = board

        // Check if finished to award prize
        let pending = matches.filter { $0.status == "pending" }
        if pending.isEmpty && !matches.isEmpty {
            self.status = "completed"
            if let winner = board.first {
                let couponChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
                var code = "TOPPADEL-"
                for _ in 1...6 {
                    code.append(couponChars.randomElement()!)
                }
                self.reward = AmericanoReward(
                    id: UUID().uuidString,
                    tournament_id: tournamentId!,
                    winner_team_id: winner.id,
                    sponsor_coupon_code: code,
                    prize_name: localizedString("prize_desc")
                )
            }
        } else {
            self.reward = nil
        }
    }

    private func getTeamDisplayName(_ id: String) -> String {
        teams.first(where: { $0.id == id })?.display_name ?? "Team"
    }

    private func getWinnerName() -> String {
        guard let reward = reward else { return "" }
        return teams.first(where: { $0.id == reward.winner_team_id })?.display_name ?? "Winner Team"
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

    private func localizedString(_ key: String) -> String {
        let code = locale.language.languageCode?.identifier ?? "az"
        
        let azDict = [
            "game_name": "Oyunun adı",
            "friendly_match": "Yoldaşlıq görüşü",
            "select_format": "Formatı seçin",
            "solo": "Fərdi",
            "team": "Komanda",
            "add_players": "Oyunçu adlarını daxil edin",
            "player_name_placeholder": "Oyunçu adı",
            "add": "Əlavə et",
            "participants_warning": "İştirakçı sayı 4 ilə 12 arasında olduqda oyunu təşkil etmək olar.",
            "select_courts": "Oynadığınız meydançaları seçin",
            "start_game": "Oyuna başla",
            "matches": "Oyunlar",
            "leaderboard": "Reytinq cədvəli",
            "record": "Hesabı yaz",
            "cancel": "Ləğv et",
            "save": "Yadda saxla",
            "reset": "Sıfırla",
            "sponsor_reward": "Sponsor Mükafatı",
            "copy": "Kodu kopyala",
            "copied": "Kopyalandı!",
            "prize_desc": "Top Padel Baku-da 1 saatlıq pulsuz meydan slotu kuponu",
            "win_short": "Q",
            "draw_short": "H",
            "loss_short": "M",
            "points": "Xal",
            "diff": "Fərq"
        ]

        let enDict = [
            "game_name": "Game name",
            "friendly_match": "A friendly match",
            "select_format": "Select game format",
            "solo": "Solo",
            "team": "Team",
            "add_players": "Add player names",
            "player_name_placeholder": "Player name",
            "add": "Add",
            "participants_warning": "The game can be organized if the number of participants is between 4 and 12 players.",
            "select_courts": "Select the courts where you're playing",
            "start_game": "Start game",
            "matches": "Matches",
            "leaderboard": "Leaderboard",
            "record": "Record score",
            "cancel": "Cancel",
            "save": "Save score",
            "reset": "Reset",
            "sponsor_reward": "Sponsor Reward",
            "copy": "Copy code",
            "copied": "Copied!",
            "prize_desc": "Free 1 Hour Court Slot at Top Padel Baku",
            "win_short": "W",
            "draw_short": "D",
            "loss_short": "L",
            "points": "pts",
            "diff": "Diff"
        ]

        let ruDict = [
            "game_name": "Название игры",
            "friendly_match": "Товарищеский матч",
            "select_format": "Выберите формат",
            "solo": "Соло",
            "team": "Команда",
            "add_players": "Добавьте имена игроков",
            "player_name_placeholder": "Имя игрока",
            "add": "Добавить",
            "participants_warning": "Игра может быть организована, если количество участников от 4 до 12 игроков.",
            "select_courts": "Выберите корты, на которых играете",
            "start_game": "Начать игру",
            "matches": "Матчи",
            "leaderboard": "Турнирная таблица",
            "record": "Записать счет",
            "cancel": "Отмена",
            "save": "Сохранить",
            "reset": "Сбросить",
            "sponsor_reward": "Спонсорская награда",
            "copy": "Копировать код",
            "copied": "Скопировано!",
            "prize_desc": "Купон на 1 час бесплатной игры в Top Padel Baku",
            "win_short": "В",
            "draw_short": "Н",
            "loss_short": "П",
            "points": "очк.",
            "diff": "Разн."
        ]

        if code.hasPrefix("en") {
            return enDict[key] ?? key
        } else if code.hasPrefix("ru") {
            return ruDict[key] ?? key
        }
        return azDict[key] ?? key
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
                    Text("\(getTeamDisplayName(match.team_a_id)) vs \(getTeamDisplayName(match.team_b_id))")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(DSColor.textPrimary)
                    Text(match.court_name)
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
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: localizedString("record")))
                }
            } else {
                Button {
                    openScoreRecord(match)
                } label: {
                    Text(localizedString("record"))
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
