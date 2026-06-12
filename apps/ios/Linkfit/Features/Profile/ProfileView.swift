import SwiftUI

/// Profile screen rebuilt around native iOS navigation and restrained glass
/// surfaces. Rebuilt from scratch in 2026-05-31 to deliver a premium, clean,
/// and fully best-practice minimal design in high-contrast light mode.
struct ProfileView: View {
    @Environment(\.dismiss) private var dismiss
    @State var viewModel: ProfileViewModel
    @State private var showEdit = false
    @State private var showShare = false
    @State private var showSettings = false
    @State private var showInsights = false
    @State private var showAchievements = false
    @State private var showStreaks = false
    @State private var showMedical = false
    @State private var showSquads = false
    @State private var showLeaderboards = false
    @State private var showStreaksSheet = false
    @State private var showInviteFriends = false
    @State private var streakLoadedValue: Int?
    @State private var followsSheet: FollowsListSheetPayload?
    @State private var milestoneStoryPayload: ProfileStoryImagePayload?
    @State private var isRenderingMilestone = false
    @State private var reportPayload: ReportTargetPayload?
    @State private var confirmBlock = false
    @State private var confirmUnfollow = false
    @State private var pendingThread: PendingThread?
    @State private var isStartingConversation = false
    @State private var pushedProfileUserId: PushedProfile?

    fileprivate struct PendingThread: Identifiable, Hashable {
        let conversation_id: String
        var id: String { conversation_id }
    }

    fileprivate struct PushedProfile: Identifiable, Hashable {
        let userId: String
        var id: String { userId }
    }

    var body: some View {
        ZStack {
            // Pure white minimal background
            DSColor.background.ignoresSafeArea()
            
            // Soft top brand glow
            RadialGradient(
                colors: [DSColor.accent.opacity(0.04), Color.clear],
                center: .topTrailing,
                startRadius: 10,
                endRadius: 360
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)
            
            content
        }
        .navigationTitle(Text("tab.profile"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    showShare = true
                } label: {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 16, weight: .semibold))
                }
                .accessibilityLabel(Text("profile.action.share"))

                if viewModel.isMe {
                    Button {
                        UISelectionFeedbackGenerator().selectionChanged()
                        showEdit = true
                    } label: {
                        Image(systemName: "pencil")
                            .font(.system(size: 16, weight: .semibold))
                    }
                    .accessibilityLabel(Text("profile.edit"))
                } else {
                    Menu {
                        if viewModel.isFollowing {
                            Button {
                                confirmUnfollow = true
                            } label: {
                                Label("profile.action.unfollow", systemImage: "person.fill.xmark")
                            }
                        }
                        Button {
                            reportPayload = ReportTargetPayload(
                                kind: .user,
                                targetId: viewModel.userId
                            )
                        } label: {
                            Label("profile.action.report", systemImage: "exclamationmark.bubble")
                        }
                        Button(role: .destructive) {
                            confirmBlock = true
                        } label: {
                            Label("profile.action.block", systemImage: "hand.raised")
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 16, weight: .semibold))
                    }
                    .accessibilityLabel(Text("profile.action.more"))
                }
            }
        }
        .reportSheet(payload: $reportPayload)
        .alert(
            Text("profile.block.unavailable.title"),
            isPresented: Binding(
                get: { viewModel.blockError != nil },
                set: { if !$0 { viewModel.clearBlockError() } }
            ),
            presenting: viewModel.blockError
        ) { _ in
            Button("common.ok", role: .cancel) { viewModel.clearBlockError() }
        } message: { message in
            Text(message)
        }
        .confirmationDialog(
            Text("profile.confirm.unfollow.title"),
            isPresented: $confirmUnfollow,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await viewModel.toggleFollow() }
            } label: {
                Text("profile.action.unfollow")
            }
            Button(role: .cancel) {} label: { Text("common.cancel") }
        } message: {
            Text("profile.confirm.unfollow.message")
        }
        .confirmationDialog(
            Text("profile.confirm.block.title"),
            isPresented: $confirmBlock,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await viewModel.blockUser() }
            } label: {
                Text("profile.action.block")
            }
            Button(role: .cancel) {} label: { Text("common.cancel") }
        } message: {
            Text("profile.confirm.block.message")
        }
        .task { await viewModel.load() }
        .task(id: viewModel.userId) { await loadStreakIfPossible() }
        .navigationDestination(isPresented: $showLeaderboards) {
            LeaderboardsView(
                viewModel: LeaderboardsViewModel(apiClient: viewModel.container.apiClient),
                onTapPlayer: { tappedId in
                    pushedProfileUserId = PushedProfile(userId: tappedId)
                }
            )
        }
        .sheet(isPresented: $showStreaksSheet) {
            NavigationStack {
                StreaksView(
                    viewModel: StreaksViewModel(
                        apiClient: viewModel.container.apiClient,
                        userId: viewModel.userId
                    )
                )
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showStreaksSheet = false
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 13, weight: .heavy))
                        }
                        .accessibilityLabel(Text("common.close"))
                    }
                }
            }
            .presentationDragIndicator(.visible)
            .presentationBackground(.ultraThinMaterial)
            .presentationDetents([.medium, .large])
        }
        .onChange(of: viewModel.blockDidSucceed) { _, success in
            guard success else { return }
            viewModel.clearBlockSuccess()
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            dismiss()
        }
        .sheet(isPresented: $showEdit) {
            Group {
                if let me = viewModel.container.currentUser {
                    EditProfileView(
                        viewModel: EditProfileViewModel(
                            apiClient: viewModel.container.apiClient,
                            container: viewModel.container,
                            user: me
                        )
                    ) { Task { await viewModel.load() } }
                }
            }
            .presentationDragIndicator(.visible)
            .presentationBackground(.ultraThinMaterial)
            .presentationDetents([.large])
        }
        .sheet(isPresented: $showShare) {
            Group {
                if case .loaded(let profile) = viewModel.state {
                    ActivityShareSheet(items: [profileShareText(profile)])
                }
            }
            .presentationDragIndicator(.visible)
        }
        .sheet(item: $milestoneStoryPayload) { payload in
            StorySharePreviewSheet(image: payload.image)
                .presentationDragIndicator(.visible)
                .presentationDetents([.medium, .large])
        }
        .sheet(item: $followsSheet) { payload in
            ProfileFollowsSheetWithRoute(
                payload: payload,
                viewerOwnsList: viewModel.isMe,
                onPickUser: { tappedId in
                    followsSheet = nil
                    Task { @MainActor in
                        try? await Task.sleep(nanoseconds: 250_000_000)
                        pushedProfileUserId = PushedProfile(userId: tappedId)
                    }
                }
            )
            .presentationDragIndicator(.visible)
            .presentationBackground(.ultraThinMaterial)
            .presentationDetents([.large])
        }
        .sheet(item: $pushedProfileUserId) { pushed in
            NavigationStack {
                ProfileView(viewModel: ProfileViewModel(
                    apiClient: viewModel.container.apiClient,
                    userId: pushed.userId,
                    container: viewModel.container
                ))
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            pushedProfileUserId = nil
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 13, weight: .heavy))
                        }
                        .accessibilityLabel(Text("common.close"))
                    }
                }
            }
            .presentationDragIndicator(.visible)
            .presentationBackground(.ultraThinMaterial)
            .presentationDetents([.large])
        }
        .sheet(item: $pendingThread) { thread in
            NavigationStack {
                ConversationThreadView(
                    viewModel: ConversationThreadViewModel(
                        apiClient: viewModel.container.apiClient,
                        conversationId: thread.conversation_id,
                        realtime: viewModel.container.realtime
                    ),
                    currentUserId: viewModel.container.currentUser?.id
                )
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            pendingThread = nil
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 13, weight: .heavy))
                        }
                        .accessibilityLabel(Text("common.close"))
                    }
                }
            }
            .presentationDragIndicator(.visible)
            .presentationBackground(.ultraThinMaterial)
            .presentationDetents([.large])
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            loadingContent
        case .empty:
            EmptyStateView(
                icon: "person.crop.circle",
                title: String(localized: "profile.empty.title"),
                message: String(localized: "profile.empty.message")
            )
        case .error(let message):
            ErrorStateView(message: message) { Task { await viewModel.load() } }
        case .loaded(let profile):
            profileContent(profile)
        }
    }

    private var loadingContent: some View {
        ScrollView {
            VStack(spacing: DSSpacing.md) {
                RoundedRectangle(cornerRadius: DSRadius.xxl, style: .continuous)
                    .fill(DSColor.surface)
                    .overlay(RoundedRectangle(cornerRadius: DSRadius.xxl, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
                    .frame(height: 220)
                ForEach(0..<4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(DSColor.surface)
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
                        .frame(height: 88)
                }
            }
            .padding(DSSpacing.md)
        }
        .safeAreaPadding(.bottom, 96)
        .scrollIndicators(.hidden)
    }
    private func profileContent(_ profile: PublicProfile) -> some View {
        ScrollView {
            VStack(spacing: DSSpacing.lg) {
                // Minimal Hero Header Block
                heroBlock(profile)
                
                // Horizontal Clean Stats Card
                inlineStatsStrip(profile)
                
                // Grouped Settings & Activities Lists
                if viewModel.isMe {
                    activityGroup
                    settingsGroup
                }
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.top, DSSpacing.md)
        }
        .safeAreaPadding(.bottom, 40)
        .scrollIndicators(.hidden)
        .refreshable { await viewModel.load() }
    }

    // MARK: - Hero Block

    private func heroBlock(_ profile: PublicProfile) -> some View {
        VStack(spacing: 16) {
            // Elegant Avatar with soft hairline ring
            ZStack {
                Circle()
                    .stroke(DSColor.accent.opacity(0.12), lineWidth: 4)
                    .frame(width: 108, height: 108)
                avatar(profile, size: 96)
            }
            
            VStack(spacing: 4) {
                Text(profile.display_name)
                    .font(.system(size: 26, weight: .black, design: .rounded))
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                
                if let joined = joinedString(profile.created_at) {
                    Text(verbatim: joined)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(DSColor.textTertiary)
                }
            }
            
            // Inline Followers & Following capsules + Streak (if any)
            HStack(spacing: 8) {
                followersFollowingInlineRow(profile)
                
                if let n = streakLoadedValue, n > 0 {
                    streakChipRow(n)
                }
            }
            .padding(.top, 4)
            
            if !viewModel.isMe {
                publicActions(profile)
                    .padding(.top, 8)
            }
        }
    }

    private func followersFollowingInlineRow(_ profile: PublicProfile) -> some View {
        HStack(spacing: 8) {
            followsInline(
                count: profile.followers_count,
                labelKey: "profile.followers",
                kind: .followers,
                userId: profile.id
            )
            
            Text("·")
                .font(.system(size: 14, weight: .black))
                .foregroundStyle(DSColor.textTertiary)
            
            followsInline(
                count: profile.following_count,
                labelKey: "profile.following",
                kind: .following,
                userId: profile.id
            )
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
        .background(Capsule().fill(DSColor.surfaceElevated))
        .overlay(Capsule().strokeBorder(DSColor.border, lineWidth: 1))
    }

    private func followsInline(
        count: Int?,
        labelKey: LocalizedStringKey,
        kind: FollowListKind,
        userId: String
    ) -> some View {
        let serverCount = count ?? 0
        let delta = FollowStore.shared.followingCountDelta[userId] ?? 0
        let displayedCount = max(0, serverCount + delta)

        return Button {
            UISelectionFeedbackGenerator().selectionChanged()
            followsSheet = FollowsListSheetPayload(userId: userId, kind: kind)
        } label: {
            HStack(spacing: 4) {
                Text("\(displayedCount)")
                    .font(.system(size: 13, weight: .black, design: .rounded))
                    .foregroundStyle(DSColor.textPrimary)
                    .monospacedDigit()
                Text(labelKey)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(DSColor.textSecondary)
            }
        }
        .buttonStyle(.plain)
    }

    private func streakChipRow(_ n: Int) -> some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            showStreaksSheet = true
        } label: {
            HStack(spacing: 4) {
                Text(verbatim: "🔥")
                    .font(.system(size: 12))
                Text(String(format: String(localized: "profile.streak.chip_format"), n))
                    .font(.system(size: 11, weight: .black, design: .rounded))
                    .foregroundStyle(DSColor.accent)
                    .monospacedDigit()
                Image(systemName: "chevron.right")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(DSColor.accent.opacity(0.6))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Capsule().fill(DSColor.accent.opacity(0.08)))
            .overlay(Capsule().strokeBorder(DSColor.accent.opacity(0.24), lineWidth: 1))
        }
        .buttonStyle(BounceButtonStyle())
        .accessibilityLabel(Text(String(format: String(localized: "profile.streak.chip_format"), n)))
    }

    // MARK: - Actions for Public Profile

    private func publicActions(_ profile: PublicProfile) -> some View {
        let theyFollowMe = (profile.follows_viewer == true)
        let followTitleKey: LocalizedStringKey = {
            if viewModel.isFollowing { return "profile.action.following" }
            if theyFollowMe { return "profile.action.follow_back" }
            return "profile.action.follow"
        }()
        return HStack(spacing: 12) {
            Button {
                UISelectionFeedbackGenerator().selectionChanged()
                Task { await viewModel.toggleFollow() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: viewModel.isFollowing ? "checkmark" : "plus")
                        .font(.system(size: 12, weight: .black))
                    Text(followTitleKey)
                        .font(.system(size: 13, weight: .black, design: .rounded))
                }
                .foregroundStyle(viewModel.isFollowing ? DSColor.textPrimary : DSColor.textOnAccent)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(
                    Capsule().fill(viewModel.isFollowing ? DSColor.surfaceElevated : DSColor.accent)
                )
                .overlay(
                    Capsule().strokeBorder(viewModel.isFollowing ? DSColor.border : .clear, lineWidth: 1)
                )
            }
            .buttonStyle(BounceButtonStyle())
            
            Button {
                UISelectionFeedbackGenerator().selectionChanged()
                Task {
                    guard !isStartingConversation else { return }
                    isStartingConversation = true
                    defer { isStartingConversation = false }
                    if let id = await viewModel.startConversation() {
                        pendingThread = PendingThread(conversation_id: id)
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    if isStartingConversation {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(DSColor.textPrimary)
                            .scaleEffect(0.8)
                    } else {
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 12, weight: .bold))
                    }
                    Text("profile.action.message")
                        .font(.system(size: 13, weight: .black, design: .rounded))
                }
                .foregroundStyle(DSColor.textPrimary)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(Capsule().fill(DSColor.surfaceElevated))
                .overlay(Capsule().strokeBorder(DSColor.border, lineWidth: 1))
            }
            .buttonStyle(BounceButtonStyle())
            .disabled(isStartingConversation)
        }
    }

    // MARK: - KPI Stats Strip

    private func inlineStatsStrip(_ profile: PublicProfile) -> some View {
        let s = profileSummary(profile)
        let level = SkillLevel.from(elo: s.topElo)
        return HStack(spacing: 0) {
            // Stat 1: Skill Badge
            VStack(spacing: 6) {
                Text(level.localizedName)
                    .font(.system(size: 13, weight: .black, design: .rounded))
                    .foregroundStyle(level.accent)
                Text("skill.label")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(DSColor.textSecondary)
                    .textCase(.uppercase)
            }
            .frame(maxWidth: .infinity)
            
            dividerLine
            
            // Stat 2: Games Played
            VStack(spacing: 6) {
                Text("\(s.games)")
                    .font(.system(size: 16, weight: .black, design: .rounded))
                    .foregroundStyle(DSColor.textPrimary)
                Text("profile.kpi.games")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(DSColor.textSecondary)
                    .textCase(.uppercase)
            }
            .frame(maxWidth: .infinity)
            
            dividerLine
            
            // Stat 3: Win Rate
            VStack(spacing: 6) {
                Text("\(s.winRate)%")
                    .font(.system(size: 16, weight: .black, design: .rounded))
                    .foregroundStyle(DSColor.textPrimary)
                Text("profile.win_rate")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(DSColor.textSecondary)
                    .textCase(.uppercase)
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.vertical, 16)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous)
                .fill(DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.015), radius: 6, y: 3)
    }

    private var dividerLine: some View {
        RoundedRectangle(cornerRadius: 1)
            .fill(DSColor.border)
            .frame(width: 1, height: 24)
    }

    // MARK: - Grouped Navigation Lists

    private var activityGroup: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("profile.section.activity")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(DSColor.textSecondary)
                .textCase(.uppercase)
                .padding(.leading, 8)
            
            VStack(spacing: 0) {
                accountRow(icon: "chart.line.uptrend.xyaxis", titleKey: "profile.menu.stats") { showInsights = true }
                rowDivider
                accountRow(icon: "rosette", titleKey: "profile.menu.achievements") { showAchievements = true }
                rowDivider
                accountRow(icon: "flame.fill", titleKey: "profile.menu.streaks") { showStreaks = true }
                rowDivider
                accountRow(icon: "person.3.fill", titleKey: "profile.menu.squads") { showSquads = true }
                rowDivider
                accountRow(icon: "rectangle.portrait.on.rectangle.portrait.angled", titleKey: "profile.action.share_card") {
                    if case .loaded(let p) = viewModel.state, !isRenderingMilestone {
                        Task { await renderMilestoneAndPresent(p) }
                    }
                }
            }
            .background(RoundedRectangle(cornerRadius: DSRadius.xl).fill(DSColor.surface))
            .overlay(RoundedRectangle(cornerRadius: DSRadius.xl).strokeBorder(DSColor.border, lineWidth: 1))
            .shadow(color: Color.black.opacity(0.015), radius: 6, y: 3)
        }
    }

    private var settingsGroup: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("profile.section.settings")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(DSColor.textSecondary)
                .textCase(.uppercase)
                .padding(.leading, 8)
            
            VStack(spacing: 0) {
                accountRow(icon: "gearshape.fill", titleKey: "profile.action.settings") { showSettings = true }
                rowDivider
                accountRow(icon: "cross.case.fill", titleKey: "profile.menu.medical") { showMedical = true }
                rowDivider
                accountRow(icon: "gift.fill", titleKey: "referrals.title") { showInviteFriends = true }
            }
            .background(RoundedRectangle(cornerRadius: DSRadius.xl).fill(DSColor.surface))
            .overlay(RoundedRectangle(cornerRadius: DSRadius.xl).strokeBorder(DSColor.border, lineWidth: 1))
            .shadow(color: Color.black.opacity(0.015), radius: 6, y: 3)
        }
        .navigationDestination(isPresented: $showSettings) {
            SettingsView()
        }
        .navigationDestination(isPresented: $showSquads) {
            SquadsHook.makeListView(container: viewModel.container)
        }
        .navigationDestination(isPresented: $showInsights) {
            InsightsHook.makeView(container: viewModel.container)
        }
        .navigationDestination(isPresented: $showAchievements) {
            AchievementsView(
                viewModel: AchievementsViewModel(
                    apiClient: viewModel.container.apiClient,
                    userId: viewModel.userId
                )
            )
        }
        .navigationDestination(isPresented: $showStreaks) {
            StreaksView(
                viewModel: StreaksViewModel(
                    apiClient: viewModel.container.apiClient,
                    userId: viewModel.userId
                )
            )
        }
        .navigationDestination(isPresented: $showMedical) {
            MedicalProfileView(
                viewModel: MedicalProfileViewModel(
                    apiClient: viewModel.container.apiClient
                )
            )
        }
        .navigationDestination(isPresented: $showInviteFriends) {
            InviteFriendsView(
                viewModel: InviteFriendsViewModel(
                    apiClient: viewModel.container.apiClient
                )
            )
        }
    }

    private func accountRow(
        icon: String,
        titleKey: LocalizedStringKey,
        destructive: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            action()
        } label: {
            HStack(spacing: DSSpacing.sm) {
                ZStack {
                    Circle()
                        .fill(destructive ? DSColor.danger.opacity(0.08) : DSColor.accent.opacity(0.06))
                        .frame(width: 32, height: 32)
                    Image(systemName: icon)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(destructive ? DSColor.danger : DSColor.accent)
                }
                
                Text(titleKey)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(destructive ? DSColor.danger : DSColor.textPrimary)
                
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
        .accessibilityLabel(titleKey)
    }

    private var rowDivider: some View {
        Divider()
            .background(DSColor.border.opacity(0.6))
            .padding(.leading, 56)
    }

    // MARK: - Avatar decoders & monograms

    private func avatar(_ profile: PublicProfile, size: CGFloat) -> some View {
        ZStack {
            Circle()
                .fill(DSColor.surfaceElevated)
                .overlay(Circle().strokeBorder(DSColor.border, lineWidth: 1))

            if let image = decodedAvatar(profile) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .clipShape(Circle())
            } else if let url = avatarURL(profile) {
                CachedAsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    monogram(profile)
                }
                .clipShape(Circle())
            } else {
                monogram(profile)
            }
        }
        .frame(width: size, height: size)
        .shadow(color: Color.black.opacity(0.03), radius: 8, y: 4)
        .accessibilityHidden(true)
    }

    private func monogram(_ profile: PublicProfile) -> MonogramView {
        MonogramView(text: initials(profile.display_name))
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        return parts.joined().isEmpty ? "?" : parts.joined()
    }

    private func joinedString(_ iso: String) -> String? {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return nil }
        let formatter = DateFormatter()
        formatter.dateStyle = .long
        return String(format: String(localized: "profile.joined_format"), formatter.string(from: date))
    }

    private func avatarURL(_ profile: PublicProfile) -> URL? {
        guard let raw = profile.photo_url, !raw.hasPrefix("data:") else { return nil }
        return URL(string: raw)
    }

    private func decodedAvatar(_ profile: PublicProfile) -> UIImage? {
        guard let raw = profile.photo_url, raw.hasPrefix("data:"),
              let comma = raw.firstIndex(of: ","),
              let bytes = Data(base64Encoded: String(raw[raw.index(after: comma)...])) else {
            return nil
        }
        return UIImage(data: bytes)
    }

    private func profileSummary(_ profile: PublicProfile) -> (games: Int, wins: Int, winRate: Int, reliability: Int, topElo: Int) {
        let stats = profile.stats.filter { $0.sport_slug != "football_5" && $0.sport_slug != "football" }
        let games = stats.map(\.games_played).reduce(0, +)
        let wins = stats.map(\.games_won).reduce(0, +)
        let winRate = games == 0 ? 0 : Int(round(Double(wins) / Double(games) * 100))
        let reliability = stats.isEmpty
            ? 100
            : stats.map(\.reliability_score).reduce(0, +) / stats.count
        let topElo = stats.map(\.elo_rating).max() ?? 1200
        return (games, wins, winRate, reliability, topElo)
    }

    private func loadStreakIfPossible() async {
        guard viewModel.container.isAuthenticated else { return }
        do {
            let resp = try await viewModel.container.apiClient.send(
                .streaks(userId: viewModel.userId)
            )
            streakLoadedValue = resp.current_streak_weeks
        } catch {
            streakLoadedValue = nil
        }
    }

    private func profileShareText(_ profile: PublicProfile) -> String {
        let summary = profileSummary(profile)
        let level = SkillLevel.from(elo: summary.topElo).localizedName
        return "\(profile.display_name) on Linkfit · \(summary.games) games · \(level)"
    }

    private func renderMilestoneAndPresent(_ profile: PublicProfile) async {
        guard !isRenderingMilestone else { return }
        isRenderingMilestone = true
        defer { isRenderingMilestone = false }

        let summary = profileSummary(profile)
        let data = ShareCardHook.makeMilestoneData(
            currentElo: summary.topElo,
            previousElo: nil,
            displayName: profile.display_name,
            gamesPlayed: summary.games,
            referralCode: nil,
            shareURL: URL(string: "https://linkfit.az/u/\(profile.id)")
        )
        let image: UIImage? = await MainActor.run {
            let card = MilestoneCard(data: data)
            let renderer = ImageRenderer(content: card)
            renderer.scale = UIScreen.main.scale
            renderer.proposedSize = ProposedViewSize(ShareCardVariant.story.pointSize)
            return renderer.uiImage
        }
        guard let image else {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            return
        }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        milestoneStoryPayload = ProfileStoryImagePayload(image: image)
    }
}

// MARK: - Custom Visual Helpers

private struct MonogramView: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 28, weight: .bold, design: .rounded))
            .foregroundStyle(DSColor.accent)
    }
}

private struct BounceButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

private struct ProfileStoryImagePayload: Identifiable {
    let id = UUID()
    let image: UIImage
}

private struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ viewController: UIActivityViewController, context: Context) {}
}

// MARK: - Profile Follows Sheet

private struct ProfileFollowsSheetWithRoute: View {
    let payload: FollowsListSheetPayload
    let viewerOwnsList: Bool
    let onPickUser: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(AppContainer.self) private var container
    @State private var viewModel: FollowListViewModel?
    @State private var removalsInFlight: Set<String> = []
    @State private var removalErrorMessage: String?

    private var canOfferRemoval: Bool {
        viewerOwnsList && payload.kind == .followers
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                content
            }
            .navigationTitle(Text(payload.kind.titleKey))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(DSColor.textPrimary)
                            .padding(8)
                            .background(Circle().fill(DSColor.surfaceElevated))
                    }
                    .accessibilityLabel(Text("common.close"))
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task {
            if viewModel == nil {
                viewModel = FollowListViewModel(
                    apiClient: container.apiClient,
                    userId: payload.userId,
                    kind: payload.kind,
                    viewerUserId: container.currentUser?.id
                )
                await viewModel?.onAppear()
            }
        }
        .alert(
            Text("follows.action.remove_failed"),
            isPresented: Binding(
                get: { removalErrorMessage != nil },
                set: { if !$0 { removalErrorMessage = nil } }
            ),
            presenting: removalErrorMessage
        ) { _ in
            Button("common.ok", role: .cancel) { removalErrorMessage = nil }
        } message: { message in
            Text(verbatim: message)
        }
    }

    @ViewBuilder
    private var content: some View {
        if let vm = viewModel {
            switch vm.state {
            case .idle, .loading:
                LoadingView()
            case .empty:
                EmptyStateView(
                    icon: payload.kind == .followers ? "person.2.slash" : "person.crop.circle.badge.questionmark",
                    title: String(localized: payload.kind.emptyTitleKey),
                    message: String(localized: payload.kind.emptyMessageKey)
                )
            case .error(let message):
                ErrorStateView(message: message) { Task { await vm.refresh() } }
            case .loaded(let items):
                List {
                    ForEach(items) { edge in
                        row(edge)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 4, leading: DSSpacing.md, bottom: 4, trailing: DSSpacing.md))
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                if canOfferRemoval, !removalsInFlight.contains(edge.id) {
                                    Button(role: .destructive) {
                                        Task { await performRemoval(of: edge) }
                                    } label: {
                                        Label("Remove", systemImage: "person.crop.circle.badge.xmark")
                                    }
                                }
                            }
                            .onAppear {
                                if edge.id == items.last?.id {
                                    Task { await vm.loadMore() }
                                }
                            }
                    }
                    if vm.isPaging {
                        HStack {
                            Spacer()
                            ProgressView().tint(DSColor.accent)
                            Spacer()
                        }
                        .listRowBackground(Color.clear)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .refreshable { await vm.refresh() }
            }
        } else {
            LoadingView()
        }
    }

    private func row(_ edge: FollowEdge) -> some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            onPickUser(edge.id)
        } label: {
            HStack(spacing: DSSpacing.sm) {
                avatar(for: edge)
                VStack(alignment: .leading, spacing: 2) {
                    Text(edge.display_name)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(DSColor.textPrimary)
                    Text(relativeFollowedAt(edge.followed_at))
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(DSColor.textTertiary)
                }
                Spacer()
                if FollowStore.shared.isFollowing(userId: edge.id) {
                    mutualPill
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(DSColor.textTertiary)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 16).fill(DSColor.surface))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(DSColor.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(BounceButtonStyle())
    }

    private func performRemoval(of edge: FollowEdge) async {
        guard let vm = viewModel, !removalsInFlight.contains(edge.id) else { return }
        removalsInFlight.insert(edge.id)
        defer { removalsInFlight.remove(edge.id) }
        do {
            try await vm.removeFollower(followerId: edge.id)
        } catch let error as APIError {
            removalErrorMessage = error.localizedMessage
        } catch {
            removalErrorMessage = error.localizedDescription
        }
    }

    private func avatar(for edge: FollowEdge) -> some View {
        let url: URL? = {
            guard let raw = edge.photo_url, !raw.hasPrefix("data:") else { return nil }
            return URL(string: raw)
        }()
        return ZStack {
            if let url {
                CachedAsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initialsCircle(edge.display_name)
                }
            } else {
                initialsCircle(edge.display_name)
            }
        }
        .frame(width: 40, height: 40)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(DSColor.border, lineWidth: 1))
    }

    private func initialsCircle(_ name: String) -> some View {
        ZStack {
            Circle().fill(LinearGradient(
                colors: [DSColor.accent, DSColor.accentSoft],
                startPoint: .topLeading, endPoint: .bottomTrailing
            ))
            Text(initials(name))
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white)
        }
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        return parts.joined().isEmpty ? "?" : parts.joined()
    }

    private func relativeFollowedAt(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = formatter.date(from: iso)
        if date == nil {
            formatter.formatOptions = [.withInternetDateTime]
            date = formatter.date(from: iso)
        }
        guard let d = date else { return iso }
        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .short
        let tmpl = String(localized: "follow.followed_at_format")
        return String(format: tmpl, relative.localizedString(for: d, relativeTo: Date()))
    }

    private var mutualPill: some View {
        Text("profile.mutual")
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(DSColor.accent)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(DSColor.accent.opacity(0.08)))
            .overlay(Capsule().strokeBorder(DSColor.accent.opacity(0.24), lineWidth: 0.5))
    }
}
