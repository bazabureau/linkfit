import SwiftUI

/// Detail screen — hero, schedule, venue, squad list, register/withdraw CTA.
/// Hosted in a NavigationStack via TournamentRoute.detail.
struct TournamentDetailView: View {
    @State var viewModel: TournamentDetailViewModel
    @Environment(AppContainer.self) private var container

    @State private var showRegisterSheet = false
    @State private var showWithdrawConfirm = false
    @State private var actionAlertMessage: String?
    @State private var showShareSheet = false
    @State private var groupConversationId: String?

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            ScrollView {
                content
                    .padding(.bottom, 140)
            }
            .refreshable { await viewModel.load() }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(DSColor.background, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if case .loaded = viewModel.state {
                    Button {
                        Haptics.selection()
                        showShareSheet = true
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                            .fontWeight(.semibold)
                            .foregroundStyle(DSColor.accent)
                    }
                    .accessibilityLabel(Text("tournaments.share"))
                }
            }
        }
        .sheet(isPresented: $showShareSheet) {
            if case .loaded(let d) = viewModel.state {
                TournamentShareSheet(items: [tournamentShareText(d)])
            }
        }
        .task { await viewModel.load() }
        .sheet(isPresented: $showRegisterSheet) {
            if case .loaded(let detail) = viewModel.state {
                RegisterSquadSheet(
                    tournament: detail,
                    onSubmit: { name, ids in
                        let ok = await viewModel.register(squadName: name, playerIds: ids)
                        if ok { showRegisterSheet = false }
                        return ok
                    }
                )
            }
        }
        .alert("tournaments.withdraw.confirm.title", isPresented: $showWithdrawConfirm) {
            Button("common.cancel", role: .cancel) {}
            Button("tournaments.withdraw.confirm.cta", role: .destructive) {
                Task { await viewModel.withdraw() }
            }
        } message: {
            Text("tournaments.withdraw.confirm.message")
        }
        .onChange(of: viewModel.actionState) { _, new in
            if case .failure(let msg) = new { actionAlertMessage = msg }
        }
        .alert("common.error_title", isPresented: Binding(
            get: { actionAlertMessage != nil },
            set: { if !$0 { actionAlertMessage = nil; viewModel.dismissAction() } }
        )) {
            Button("common.ok", role: .cancel) {
                actionAlertMessage = nil
                viewModel.dismissAction()
            }
        } message: {
            Text(actionAlertMessage ?? "")
        }
    }

    // MARK: - Body content

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView(label: String(localized: "tournaments.loading"))
                .frame(height: 360)
        case .empty:
            EmptyStateView(icon: "trophy",
                           title: String(localized: "tournaments.empty.title"),
                           message: String(localized: "tournaments.empty.message"))
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.load() } }
                .frame(height: 360)
        case .loaded(let detail):
            VStack(alignment: .leading, spacing: DSSpacing.md) {
                hero(detail: detail)
                summaryCard(detail: detail)
                ctaSection(detail: detail)
                if let desc = detail.description, !desc.isEmpty {
                    descriptionSection(text: desc)
                }
                squadsSection(detail: detail)
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.top, DSSpacing.md)
        }
    }

    // MARK: - Hero

    private func hero(detail: TournamentDetail) -> some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(
                colors: [DSColor.accent, DSColor.accentSoft],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            Image(systemName: TournamentSportIcon.forSlug(detail.sport_slug))
                .font(.system(size: 130, weight: .bold))
                .foregroundStyle(DSColor.textOnAccent.opacity(0.10))
                .rotationEffect(.degrees(-8))
                .offset(x: 140, y: -20)

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    TournamentStatusChip(status: detail.status)
                    SportPill(slug: detail.sport_slug)
                }
                Text(detail.name)
                    .font(.system(.title2, design: .default, weight: .heavy))
                    .foregroundStyle(DSColor.textOnAccent)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(DSSpacing.md)
        }
        .frame(height: 200)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    // MARK: - Summary card

    private func summaryCard(detail: TournamentDetail) -> some View {
        VStack(spacing: DSSpacing.sm) {
            summaryRow(icon: "calendar",
                       title: String(localized: "tournaments.summary.dates"),
                       value: formattedDateRange(detail: detail))

            if let venue = detail.venue_name {
                summaryRow(icon: "mappin.and.ellipse",
                           title: String(localized: "tournaments.summary.venue"),
                           value: venue)
            }

            summaryRow(icon: "person.3.fill",
                       title: String(localized: "tournaments.summary.squads"),
                       value: String(format: String(localized: "tournaments.squads_format"),
                                     detail.entries_count, detail.max_squads))

            summaryRow(icon: "person.fill",
                       title: String(localized: "tournaments.summary.squad_size"),
                       value: "\(detail.squad_size)")

            summaryRow(icon: detail.entry_fee_minor > 0 ? "creditcard.fill" : "gift.fill",
                       title: String(localized: "tournaments.summary.entry_fee"),
                       value: detail.entry_fee_minor > 0
                           ? Money.format(minor: detail.entry_fee_minor, currency: detail.currency)
                           : String(localized: "tournaments.fee.free"))

            if let deadlineISO = detail.registration_deadline {
                summaryRow(icon: "clock.fill",
                           title: String(localized: "tournaments.summary.deadline"),
                           value: bakuDateAndTime(deadlineISO))
            }
        }
        .padding(DSSpacing.md)
        .background(RoundedRectangle(cornerRadius: 20).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(DSColor.border, lineWidth: 1))
    }

    private func summaryRow(icon: String, title: String, value: String) -> some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(DSColor.accent)
                .frame(width: 22)
            Text(title)
                .font(.system(.footnote, design: .default))
                .foregroundStyle(DSColor.textSecondary)
            Spacer()
            Text(value)
                .font(.system(.footnote, design: .default, weight: .semibold))
                .foregroundStyle(DSColor.textPrimary)
                .lineLimit(2)
                .multilineTextAlignment(.trailing)
        }
    }

    // MARK: - CTA

    @ViewBuilder
    private func ctaSection(detail: TournamentDetail) -> some View {
        if !container.isAuthenticated {
            // Sign-in is a separate concern; show a static info pill so we
            // never present a Register CTA we know will 401.
            HStack(spacing: 8) {
                Image(systemName: "lock.fill")
                Text("tournaments.cta.sign_in_required")
                    .font(.system(.footnote, design: .default, weight: .semibold))
            }
            .foregroundStyle(DSColor.textSecondary)
            .padding(DSSpacing.md)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 16).fill(DSColor.surface))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(DSColor.border, lineWidth: 1))
        } else if detail.my_entry != nil {
            let isCaptain = detail.my_entry?.captain_user_id == container.currentUser?.id
            VStack(spacing: DSSpacing.xs) {
                if let entry = detail.my_entry {
                    registeredBanner(entry: entry)
                }

                if isCaptain {
                    if let cid = groupConversationId {
                        NavigationLink(value: HomeRoute.groupThread(cid)) {
                            HStack(spacing: 8) {
                                Image(systemName: "bubble.left.and.bubble.right.fill")
                                Text("group_chat.open_for_tournament")
                                    .font(.system(.subheadline, design: .default, weight: .semibold))
                            }
                            .foregroundStyle(DSColor.accent)
                            .padding(.horizontal, DSSpacing.md)
                            .padding(.vertical, DSSpacing.sm)
                            .background(Capsule().fill(DSColor.accent.opacity(0.12)))
                        }
                        .buttonStyle(.plain)
                    } else {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small).tint(DSColor.accent)
                            Text("group_chat.open_for_tournament")
                                .font(.system(.subheadline, design: .default, weight: .semibold))
                        }
                        .foregroundStyle(DSColor.accent)
                        .padding(.horizontal, DSSpacing.md)
                        .padding(.vertical, DSSpacing.sm)
                        .background(Capsule().fill(DSColor.accent.opacity(0.12)))
                        .task {
                            do {
                                groupConversationId = try await GroupConversationViewModel.resolveConversationId(
                                    apiClient: container.apiClient,
                                    kind: .tournament,
                                    targetId: detail.id
                                )
                            } catch {
                                // ignore
                            }
                        }
                    }
                }

                SecondaryButton(
                    title: String(localized: "tournaments.cta.withdraw"),
                    icon: "xmark.circle"
                ) { showWithdrawConfirm = true }
            }
        } else if detail.can_register {
            PrimaryButton(
                title: String(localized: "tournaments.cta.register"),
                icon: "plus.circle.fill",
                isLoading: viewModel.actionState == .running
            ) {
                showRegisterSheet = true
            }
        } else {
            HStack(spacing: 8) {
                Image(systemName: "info.circle.fill")
                Text(blockedReasonText(detail.registration_blocked_reason))
                    .font(.system(.footnote, design: .default, weight: .semibold))
            }
            .foregroundStyle(DSColor.textSecondary)
            .padding(DSSpacing.md)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 16).fill(DSColor.surface))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(DSColor.border, lineWidth: 1))
        }
    }

    private func registeredBanner(entry: TournamentEntry) -> some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(DSColor.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text("tournaments.cta.registered.title")
                    .font(.system(.footnote, design: .default, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                Text(entry.squad_name)
                    .font(.system(.caption, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
            }
            Spacer()
        }
        .padding(DSSpacing.md)
        .background(RoundedRectangle(cornerRadius: 16).fill(DSColor.accentMuted))
    }

    // MARK: - Description

    private func descriptionSection(text: String) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            Text("tournaments.detail.about")
                .font(.system(.subheadline, design: .default, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
            Text(text)
                .font(.system(.body))
                .foregroundStyle(DSColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(DSSpacing.md)
        .background(RoundedRectangle(cornerRadius: 20).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(DSColor.border, lineWidth: 1))
    }

    // MARK: - Squads

    private func squadsSection(detail: TournamentDetail) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            HStack {
                Text("tournaments.detail.squads")
                    .font(.system(.subheadline, design: .default, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                Spacer()
                Text(String(format: String(localized: "tournaments.squads_format"),
                            detail.entries_count, detail.max_squads))
                    .font(.system(.caption, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
            }

            if detail.entries.isEmpty {
                Text("tournaments.detail.no_squads")
                    .font(.system(.footnote, design: .default))
                    .foregroundStyle(DSColor.textTertiary)
                    .padding(.vertical, DSSpacing.sm)
                    .frame(maxWidth: .infinity)
            } else {
                LazyVStack(spacing: DSSpacing.xs) {
                    ForEach(detail.entries) { entry in
                        SquadRow(entry: entry,
                                 isMine: entry.captain_user_id == container.currentUser?.id)
                    }
                }
            }
        }
        .padding(DSSpacing.md)
        .background(RoundedRectangle(cornerRadius: 20).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(DSColor.border, lineWidth: 1))
    }

    private func formattedDateRange(detail: TournamentDetail) -> String {
        let start = bakuDateAndTime(detail.starts_at)
        let endShort = bakuMediumDate(detail.ends_at)
        if bakuMediumDate(detail.starts_at) == endShort {
            return start
        }
        return "\(start) → \(endShort)"
    }

    // MARK: - Baku-pinned date formatting
    //
    // Tournament timestamps describe a fixed wall-clock moment in Azerbaijan
    // (matches start at a venue in Baku, deadlines close on Baku time). Rendering
    // them in the device timezone would silently shift a 19:00 start to e.g.
    // 17:00 for a traveller. We pin to Asia/Baku and tag the time-bearing string
    // with a "Bakı vaxtı" suffix so the displayed clock is unambiguous.
    //
    // Parsing goes through the tolerant `Date.fromISO` foundation (handles the
    // fractional-seconds shape the API emits); on a parse miss we fall back to
    // the raw string rather than dropping the value.

    private static let bakuTimeZone = TimeZone(identifier: "Asia/Baku")

    private func bakuMediumDate(_ iso: String) -> String {
        guard let date = Date.fromISO(iso) else { return iso }
        let f = DateFormatter()
        f.timeZone = Self.bakuTimeZone
        f.dateStyle = .medium
        return f.string(from: date)
    }

    private func bakuDateAndTime(_ iso: String) -> String {
        guard let date = Date.fromISO(iso) else { return iso }
        let f = DateFormatter()
        f.timeZone = Self.bakuTimeZone
        f.dateStyle = .medium
        f.timeStyle = .short
        let stamp = f.string(from: date)
        return "\(stamp) (\(String(localized: "tournaments.time.baku_suffix")))"
    }

    private func blockedReasonText(_ reason: String?) -> String {
        switch reason {
        case "already_registered": return String(localized: "tournaments.blocked.already_registered")
        case "registration_closed": return String(localized: "tournaments.blocked.registration_closed")
        case "completed":           return String(localized: "tournaments.blocked.completed")
        case "cancelled":           return String(localized: "tournaments.blocked.cancelled")
        case "deadline_passed":     return String(localized: "tournaments.blocked.deadline_passed")
        case "full":                return String(localized: "tournaments.blocked.full")
        default:                    return String(localized: "tournaments.blocked.generic")
        }
    }

    private func tournamentShareText(_ d: TournamentDetail) -> String {
        // Single localized line — UIActivityViewController handles platform
        // chrome (Telegram caption, iMessage preview, etc.) automatically.
        String(format: String(localized: "tournaments.share.text_format"), d.name)
    }
}

// MARK: - SquadRow

private struct SquadRow: View {
    let entry: TournamentEntry
    let isMine: Bool

    var body: some View {
        HStack(alignment: .top, spacing: DSSpacing.sm) {
            ZStack {
                Circle()
                    .fill(isMine ? DSColor.accent : DSColor.surfaceElevated)
                Text(initials(from: entry.captain_display_name))
                    .font(.system(.caption, design: .default, weight: .heavy))
                    .foregroundStyle(isMine ? DSColor.textOnAccent : DSColor.textPrimary)
            }
            .frame(width: 38, height: 38)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(entry.squad_name)
                        .font(.system(.footnote, design: .default, weight: .heavy))
                        .foregroundStyle(DSColor.textPrimary)
                    if isMine {
                        Text("tournaments.detail.squad.yours")
                            .font(.system(.caption2, design: .default, weight: .heavy))
                            .foregroundStyle(DSColor.textOnAccent)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(DSColor.accent))
                    }
                }
                Text(String(format: String(localized: "tournaments.detail.squad.captain_format"),
                            entry.captain_display_name))
                    .font(.system(.caption, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                if !entry.player_names.isEmpty {
                    Text(entry.player_names.joined(separator: ", "))
                        .font(.system(.caption2, design: .default))
                        .foregroundStyle(DSColor.textTertiary)
                        .lineLimit(2)
                }
            }
            Spacer()
        }
        .padding(DSSpacing.sm)
        .background(RoundedRectangle(cornerRadius: 12).fill(DSColor.surfaceElevated))
    }

    private func initials(from name: String) -> String {
        let comps = name.split(separator: " ")
        let chars = comps.prefix(2).compactMap { $0.first }
        return String(chars).uppercased()
    }
}

/// Local UIActivityViewController bridge — every detail-style screen has its
/// own private copy so each can specialize the share payload later (e.g.,
/// attach a rendered PNG of the bracket).
private struct TournamentShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
