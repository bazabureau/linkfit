import SwiftUI

/// Single-screen settings hub. Rebuilt from scratch in 2026-05-31 with a
/// premium, clean, high-contrast, and fully best-practice minimal design.
struct SettingsView: View {
    @Environment(AppContainer.self) private var container
    @Environment(LanguageManager.self) private var language
    @Environment(\.dismiss) private var dismiss

    @State private var showEdit = false
    @State private var confirmLogout = false
    @State private var showPrivacy = false
    @State private var showMembership = false
    @State private var showSessions = false

    @State private var showMyBookings = false
    @State private var showLeaderboards = false
    @State private var showCalendar = false
    @State private var showInviteFriends = false

    // Targets pushed from inside Leaderboards / Calendar via their tap
    // callbacks. Identifiable-payload state drives `.navigationDestination`
    // so a row tap inside those screens performs real navigation instead of
    // being a dead-end chevron. Identifiable wrappers (matching
    // `BlockedUsersView`) let the stack re-push a fresh screen after back-out.
    @State private var pushedProfile: PushedID?
    @State private var pushedGame: PushedID?
    @State private var pushedTournament: PushedID?

    fileprivate struct PushedID: Identifiable, Hashable {
        let value: String
        var id: String { value }
    }

    /// Disables the sign-out control + shows a spinner while `performLogout()`
    /// is in flight, so the user can't double-tap during the network call.
    @State private var isLoggingOut = false

    private var versionString: String {
        let dict = Bundle.main.infoDictionary
        let short = (dict?["CFBundleShortVersionString"] as? String) ?? "—"
        let build = (dict?["CFBundleVersion"] as? String) ?? "—"
        return "\(short) (\(build))"
    }

    var body: some View {
        @Bindable var language = language
        ZStack {
            DSColor.background.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 24) {
                    // Category 1: Account
                    VStack(alignment: .leading, spacing: 8) {
                        sectionHeader("settings.section.account")
                        
                        VStack(spacing: 0) {
                            settingsRow(icon: "pencil", titleKey: "profile.edit") { showEdit = true }
                            rowDivider
                            settingsRow(icon: "calendar.badge.checkmark", titleKey: "settings.row.my_bookings") { showMyBookings = true }
                            rowDivider
                            settingsRow(icon: "crown.fill", titleKey: "settings.row.membership", tint: DSColor.accent) { showMembership = true }
                            rowDivider
                            settingsRow(icon: "laptopcomputer.and.iphone", titleKey: "sessions.title") { showSessions = true }
                            rowDivider
                            settingsRow(icon: "person.crop.circle.badge.minus", titleKey: "settings.account.delete", tint: DSColor.danger) { showPrivacy = true }
                        }
                        .background(RoundedRectangle(cornerRadius: 20).fill(DSColor.surface))
                        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(DSColor.border, lineWidth: 1))
                        .shadow(color: DSColor.inkSurface.opacity(0.015), radius: 6, y: 3)
                    }
                    
                    // Category 2: Discover
                    VStack(alignment: .leading, spacing: 8) {
                        sectionHeader("settings.section.discover")
                        
                        VStack(spacing: 0) {
                            settingsRow(icon: "trophy.fill", titleKey: "settings.row.leaderboards") { showLeaderboards = true }
                            rowDivider
                            settingsRow(icon: "calendar", titleKey: "settings.row.calendar") { showCalendar = true }
                        }
                        .background(RoundedRectangle(cornerRadius: 20).fill(DSColor.surface))
                        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(DSColor.border, lineWidth: 1))
                        .shadow(color: DSColor.inkSurface.opacity(0.015), radius: 6, y: 3)
                    }
                    
                    // Category 3: Social
                    VStack(alignment: .leading, spacing: 8) {
                        sectionHeader("settings.section.social")
                        
                        VStack(spacing: 0) {
                            settingsRow(icon: "person.2.fill", titleKey: "settings.row.invite_friends") { showInviteFriends = true }
                        }
                        .background(RoundedRectangle(cornerRadius: 20).fill(DSColor.surface))
                        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(DSColor.border, lineWidth: 1))
                        .shadow(color: DSColor.inkSurface.opacity(0.015), radius: 6, y: 3)
                    }
                    
                    // Category 4: Notifications & Privacy
                    VStack(alignment: .leading, spacing: 8) {
                        sectionHeader("settings.section.notifications")
                        
                        VStack(spacing: 0) {
                            // Push Preferences navigation row
                            NavigationLink {
                                NotificationPreferencesView(
                                    viewModel: NotificationPreferencesViewModel(apiClient: container.apiClient)
                                )
                            } label: {
                                HStack(spacing: DSSpacing.sm) {
                                    ZStack {
                                        Circle()
                                            .fill(DSColor.accent.opacity(0.06))
                                            .frame(width: 32, height: 32)
                                        Image(systemName: "bell.badge")
                                            .font(.system(size: 13, weight: .bold))
                                            .foregroundStyle(DSColor.accent)
                                    }
                                    Text("settings.notifications.push")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundStyle(DSColor.textPrimary)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(DSColor.textTertiary)
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 10)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(BounceButtonStyle())
                            
                            rowDivider
                            
                            // Blocked Users navigation row
                            NavigationLink {
                                BlockedUsersView()
                            } label: {
                                HStack(spacing: DSSpacing.sm) {
                                    ZStack {
                                        Circle()
                                            .fill(DSColor.accent.opacity(0.06))
                                            .frame(width: 32, height: 32)
                                        Image(systemName: "hand.raised.fill")
                                            .font(.system(size: 13, weight: .bold))
                                            .foregroundStyle(DSColor.accent)
                                    }
                                    Text("settings.privacy.blocked_users")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundStyle(DSColor.textPrimary)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(DSColor.textTertiary)
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 10)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(BounceButtonStyle())
                        }
                        .background(RoundedRectangle(cornerRadius: 20).fill(DSColor.surface))
                        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(DSColor.border, lineWidth: 1))
                        .shadow(color: DSColor.inkSurface.opacity(0.015), radius: 6, y: 3)
                    }
                    
                    // Category 5: Preferences & About
                    VStack(alignment: .leading, spacing: 8) {
                        sectionHeader("settings.section.about")
                        
                        VStack(spacing: 0) {
                            // Theme row with integrated ThemeSwitcher below
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: DSSpacing.sm) {
                                    ZStack {
                                        Circle()
                                            .fill(DSColor.accent.opacity(0.06))
                                            .frame(width: 32, height: 32)
                                        Image(systemName: "paintpalette.fill")
                                            .font(.system(size: 13, weight: .bold))
                                            .foregroundStyle(DSColor.accent)
                                    }
                                    Text("settings.theme.title")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundStyle(DSColor.textPrimary)
                                    Spacer()
                                }
                                ThemeSwitcher()
                                    .padding(.top, 4)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            
                            rowDivider
                            
                            // Language inline Menu picker
                            Menu {
                                ForEach(AppLanguage.allCases) { lang in
                                    Button {
                                        language.current = lang
                                        UISelectionFeedbackGenerator().selectionChanged()
                                    } label: {
                                        Label(lang.displayKey, systemImage: lang == language.current ? "checkmark" : "")
                                    }
                                }
                            } label: {
                                HStack(spacing: DSSpacing.sm) {
                                    ZStack {
                                        Circle()
                                            .fill(DSColor.accent.opacity(0.06))
                                            .frame(width: 32, height: 32)
                                        Image(systemName: "globe")
                                            .font(.system(size: 13, weight: .bold))
                                            .foregroundStyle(DSColor.accent)
                                    }
                                    Text("settings.language")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundStyle(DSColor.textPrimary)
                                    Spacer()
                                    Text(language.current.displayKey)
                                        .font(.system(size: 13, weight: .bold))
                                        .foregroundStyle(DSColor.textSecondary)
                                    Image(systemName: "chevron.up.chevron.down")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(DSColor.textTertiary)
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 10)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(BounceButtonStyle())
                            
                            rowDivider
                            
                            // App Version static row
                            HStack(spacing: DSSpacing.sm) {
                                ZStack {
                                    Circle()
                                        .fill(DSColor.accent.opacity(0.06))
                                        .frame(width: 32, height: 32)
                                    Image(systemName: "info.circle.fill")
                                        .font(.system(size: 13, weight: .bold))
                                        .foregroundStyle(DSColor.accent)
                                }
                                Text("settings.about.version")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(DSColor.textPrimary)
                                Spacer()
                                Text(verbatim: versionString)
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(DSColor.textSecondary)
                                    .monospacedDigit()
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                        }
                        .background(RoundedRectangle(cornerRadius: 20).fill(DSColor.surface))
                        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(DSColor.border, lineWidth: 1))
                        .shadow(color: DSColor.inkSurface.opacity(0.015), radius: 6, y: 3)
                    }
                    
                    // Logout full-width capsule button
                    Button {
                        UISelectionFeedbackGenerator().selectionChanged()
                        confirmLogout = true
                    } label: {
                        HStack(spacing: 8) {
                            Spacer()
                            if isLoggingOut {
                                ProgressView()
                                    .controlSize(.small)
                                    .tint(DSColor.danger)
                            } else {
                                Image(systemName: "rectangle.portrait.and.arrow.right")
                                    .font(.system(size: 14, weight: .bold))
                            }
                            Text("common.signout")
                                .font(.system(size: 14, weight: .black))
                            Spacer()
                        }
                        .foregroundStyle(DSColor.danger.opacity(isLoggingOut ? 0.5 : 1))
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .background(
                            Capsule().fill(DSColor.danger.opacity(0.08))
                        )
                        .overlay(
                            Capsule().strokeBorder(DSColor.danger.opacity(0.24), lineWidth: 1)
                        )
                    }
                    .buttonStyle(BounceButtonStyle())
                    .disabled(isLoggingOut)
                    .padding(.top, 8)
                    
                    Spacer().frame(height: 56)
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.top, DSSpacing.md)
            }
            .scrollIndicators(.hidden)
        }
        .navigationTitle(Text("settings.title"))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showEdit) {
            Group {
                if let me = container.currentUser {
                    EditProfileView(
                        viewModel: EditProfileViewModel(
                            apiClient: container.apiClient,
                            container: container,
                            user: me
                        )
                    ) {}
                }
            }
            .presentationDragIndicator(.visible)
            .presentationBackground(.ultraThinMaterial)
            .presentationDetents([.large])
        }
        .confirmationDialog(
            Text("settings.logout.confirm.title"),
            isPresented: $confirmLogout,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await performLogout() }
            } label: {
                Text("common.signout")
            }
            Button(role: .cancel) {} label: { Text("common.cancel") }
        } message: {
            Text("settings.logout.confirm.message")
        }
        .navigationDestination(isPresented: $showPrivacy) {
            // Real GDPR hub: data export + 30-day-grace account deletion.
            // Replaces the old "coming soon" dead-end (Apple requires an
            // in-app deletion path for apps with account creation).
            PrivacyView()
        }
        .navigationDestination(isPresented: $showMembership) {
            MembershipView(viewModel: MembershipViewModel(apiClient: container.apiClient))
        }
        .navigationDestination(isPresented: $showSessions) {
            SessionsView(viewModel: SessionsViewModel(apiClient: container.apiClient))
        }
        .navigationDestination(isPresented: $showMyBookings) {
            MyBookingsView(
                viewModel: MyBookingsViewModel(apiClient: container.apiClient)
            )
        }
        .navigationDestination(isPresented: $showLeaderboards) {
            LeaderboardsView(
                viewModel: LeaderboardsViewModel(apiClient: container.apiClient),
                onTapPlayer: { userId in pushedProfile = PushedID(value: userId) }
            )
        }
        .navigationDestination(isPresented: $showCalendar) {
            AgendaCalendarView(
                viewModel: AgendaCalendarViewModel(apiClient: container.apiClient),
                onTapGame: { item in pushedGame = PushedID(value: item.id) },
                onTapBooking: { _ in showMyBookings = true },
                onTapTournament: { item in pushedTournament = PushedID(value: item.id) }
            )
        }
        .navigationDestination(item: $pushedProfile) { pushed in
            ProfileView(
                viewModel: ProfileViewModel(
                    apiClient: container.apiClient,
                    userId: pushed.value,
                    container: container
                )
            )
        }
        .navigationDestination(item: $pushedGame) { pushed in
            GameDetailView(
                viewModel: GameDetailViewModel(
                    apiClient: container.apiClient,
                    gameId: pushed.value,
                    currentUserId: container.currentUser?.id
                )
            )
        }
        .navigationDestination(item: $pushedTournament) { pushed in
            TournamentDetailView(
                viewModel: TournamentDetailViewModel(
                    apiClient: container.apiClient,
                    tournamentId: pushed.value
                )
            )
        }
        .navigationDestination(isPresented: $showInviteFriends) {
            ReferralsHook.makeView(container: container)
        }
    }

    // MARK: - Row primitives

    private func settingsRow(
        icon: String,
        titleKey: LocalizedStringKey,
        tint: Color = DSColor.textSecondary,
        showsChevron: Bool = true,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            action()
        } label: {
            HStack(spacing: DSSpacing.sm) {
                ZStack {
                    Circle()
                        .fill(tint.opacity(0.08))
                        .frame(width: 32, height: 32)
                    Image(systemName: icon)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(tint)
                }
                
                Text(titleKey)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(tint == DSColor.danger ? DSColor.danger : DSColor.textPrimary)
                
                Spacer()
                
                if showsChevron {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(DSColor.textTertiary)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(BounceButtonStyle())
    }

    private var rowDivider: some View {
        Divider()
            .background(DSColor.border.opacity(0.6))
            .padding(.leading, 56)
    }

    private func sectionHeader(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(DSColor.textSecondary)
            .padding(.leading, 8)
    }

    private func performLogout() async {
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
        isLoggingOut = true
        guard let refresh = container.tokenStore.refreshToken() else {
            container.clearSession()
            return
        }
        _ = try? await container.apiClient.send(Endpoint<EmptyResponse>.logout(refreshToken: refresh))
        container.clearSession()
    }
}

// MARK: - Bounce Button Style

private struct BounceButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}
