import SwiftUI

/// Squad detail screen. Reachable from the SquadsListView push or from a
/// future deep-link.
///
/// Layout (top → bottom):
///   1. Hero header (photo medallion + name + description).
///   2. Member chips strip (avatar + name) — horizontal scrolling row.
///   3. "Üzv dəvət et" affordance (owner-visible only).
///   4. "Bu həftə oyunlar" section — list of games where 2+ members
///      participate; reuses the same MatchRowCard-style row chrome from
///      the discovery feed.
///   5. Owner actions: edit / delete (rendered as a quiet footer).
///      Non-owner: a single "Squad-dan çıx" destructive button.
struct SquadDetailView: View {
    @State var viewModel: SquadDetailViewModel
    /// Callback used by the parent list to refresh its row on edit, or
    /// drop the row on leave / delete. Optional so unit tests can spin up
    /// the view without piping the wiring.
    var onMutated: ((SquadMutation) -> Void)?

    @Environment(\.dismiss) private var dismiss

    @State private var showInvite = false
    @State private var showEdit = false
    @State private var confirmLeave = false
    @State private var confirmDelete = false

    var body: some View {
        ZStack {
            AppGlassBackground()
            content
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                if case .loaded(let squad) = viewModel.state {
                    Text(squad.name)
                        .font(.system(size: 17, weight: .heavy))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                } else {
                    Text("squads.title")
                        .font(.system(size: 17, weight: .heavy))
                        .foregroundStyle(DSColor.textPrimary)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if viewModel.isOwner {
                    Button {
                        UISelectionFeedbackGenerator().selectionChanged()
                        showEdit = true
                    } label: {
                        Image(systemName: "pencil")
                            .fontWeight(.semibold)
                    }
                    .accessibilityLabel(Text("squads.edit"))
                }
            }
        }
        .task { await viewModel.onAppear() }
        .refreshable { await viewModel.load() }
        .sheet(isPresented: $showInvite) {
            if case .loaded(let squad) = viewModel.state {
                SquadInviteSheet(
                    detailViewModel: viewModel,
                    excludedUserIds: Set(squad.members.map(\.user_id))
                )
            }
        }
        .sheet(isPresented: $showEdit) {
            if case .loaded(let squad) = viewModel.state {
                EditSquadSheet(
                    initialName: squad.name,
                    initialDescription: squad.description ?? ""
                ) { newName, newDesc in
                    Task {
                        if let updated = await viewModel.updateSquad(
                            name: newName,
                            description: newDesc.isEmpty ? nil : newDesc
                        ) {
                            onMutated?(.updated(updated))
                            showEdit = false
                        }
                    }
                }
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
                .presentationBackground(.ultraThinMaterial)
            }
        }
        .confirmationDialog(
            Text("squads.confirm.leave.title"),
            isPresented: $confirmLeave,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task {
                    if let mutation = await viewModel.leave() {
                        onMutated?(mutation)
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                        dismiss()
                    }
                }
            } label: {
                Text("squads.leave")
            }
            Button(role: .cancel) {} label: { Text("common.cancel") }
        } message: {
            Text("squads.confirm.leave.message")
        }
        .confirmationDialog(
            Text("squads.confirm.delete.title"),
            isPresented: $confirmDelete,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task {
                    if let mutation = await viewModel.delete() {
                        onMutated?(mutation)
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                        dismiss()
                    }
                }
            } label: {
                Text("squads.delete")
            }
            Button(role: .cancel) {} label: { Text("common.cancel") }
        } message: {
            Text("squads.confirm.delete.message")
        }
        .alert(
            Text("common.error_title"),
            isPresented: Binding(
                get: { viewModel.actionError != nil },
                set: { if !$0 { viewModel.clearError() } }
            ),
            presenting: viewModel.actionError
        ) { _ in
            Button("common.ok", role: .cancel) { viewModel.clearError() }
        } message: { message in
            Text(verbatim: message)
        }
    }

    // MARK: - Content states

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView()
        case .empty:
            EmptyStateView(
                icon: "person.3",
                title: String(localized: "squads.empty.title"),
                message: String(localized: "squads.empty.message")
            )
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.load() } }
        case .loaded(let squad):
            loadedContent(squad)
        }
    }

    private func loadedContent(_ squad: SquadWithMembers) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                heroHeader(squad)
                membersSection(squad)
                if viewModel.isOwner {
                    inviteButton
                }
                gamesSection
                actionsFooter(squad)
                Spacer().frame(height: 72)
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
        }
        .scrollIndicators(.hidden)
    }

    // MARK: - Hero

    private func heroHeader(_ squad: SquadWithMembers) -> some View {
        VStack(spacing: 14) {
            heroPhoto(squad)
            VStack(spacing: 6) {
                Text(squad.name)
                    .font(.system(size: 24, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                if let desc = squad.description, !desc.isEmpty {
                    Text(desc)
                        .font(.system(size: 14, weight: .regular))
                        .foregroundStyle(DSColor.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineSpacing(2)
                        .padding(.horizontal, 12)
                }
                Text(String(format: String(localized: "squads.member_count_format"),
                            squad.members.count, squad.max_size))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DSColor.textTertiary)
                    .monospacedDigit()
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func heroPhoto(_ squad: SquadWithMembers) -> some View {
        ZStack {
            Circle()
                .fill(DSColor.accent.opacity(0.12))
                .frame(width: 116, height: 116)
            Circle()
                .strokeBorder(DSColor.accent.opacity(0.35), lineWidth: 1)
                .frame(width: 116, height: 116)
            if let url = squadPhotoURL(squad.photo_url) {
                CachedAsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    monogram(squad.name)
                }
                .frame(width: 96, height: 96)
                .clipShape(Circle())
            } else {
                monogram(squad.name)
                    .frame(width: 96, height: 96)
                    .clipShape(Circle())
            }
        }
        .shadow(color: Color.black.opacity(0.10), radius: 12, y: 6)
    }

    private func monogram(_ name: String) -> some View {
        ZStack {
            LinearGradient(
                colors: [DSColor.accent, DSColor.accentSoft],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Text(initials(name))
                .font(.system(size: 30, weight: .heavy))
                .foregroundStyle(DSColor.textOnAccent)
        }
    }

    // MARK: - Members

    private func membersSection(_ squad: SquadWithMembers) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("squads.section.members")
                .font(.system(size: 15, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(squad.members) { member in
                        memberChip(member)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func memberChip(_ member: SquadMember) -> some View {
        VStack(spacing: 6) {
            ZStack {
                if let url = memberPhotoURL(member.photo_url) {
                    CachedAsyncImage(url: url) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        memberInitials(member.display_name)
                    }
                } else {
                    memberInitials(member.display_name)
                }
            }
            .frame(width: 52, height: 52)
            .clipShape(Circle())
            .overlay(
                Circle().strokeBorder(
                    member.is_owner ? DSColor.accent : DSColor.border.opacity(0.6),
                    lineWidth: member.is_owner ? 2 : 1
                )
            )
            Text(firstName(member.display_name))
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(DSColor.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: 64)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(member.display_name))
    }

    private func memberInitials(_ name: String) -> some View {
        ZStack {
            Circle().fill(LinearGradient(
                colors: [DSColor.accent, DSColor.accentSoft],
                startPoint: .topLeading, endPoint: .bottomTrailing
            ))
            Text(initials(name))
                .font(.system(size: 16, weight: .heavy))
                .foregroundStyle(DSColor.textOnAccent)
        }
    }

    // MARK: - Invite affordance

    private var inviteButton: some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            showInvite = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "person.crop.circle.badge.plus")
                    .font(.system(size: 15, weight: .heavy))
                Text("squads.invite")
                    .font(.system(size: 15, weight: .heavy))
            }
            .foregroundStyle(DSColor.textOnAccent)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(Capsule().fill(DSColor.accent))
            .shadow(color: DSColor.accent.opacity(0.25), radius: 8, y: 4)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("squads.invite"))
    }

    // MARK: - Games

    private var gamesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("squads.section.this_week_games")
                .font(.system(size: 15, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
            if !viewModel.gamesLoaded {
                ProgressView()
                    .controlSize(.regular)
                    .tint(DSColor.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
            } else if viewModel.games.isEmpty {
                emptyGamesCard
            } else {
                VStack(spacing: 8) {
                    ForEach(viewModel.games) { game in
                        SquadGameRow(game: game)
                    }
                }
            }
        }
    }

    private var emptyGamesCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("squads.games.empty.title")
                .font(.system(size: 14, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
            Text("squads.games.empty.message")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(DSColor.textSecondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1)
        )
    }

    // MARK: - Footer actions

    @ViewBuilder
    private func actionsFooter(_ squad: SquadWithMembers) -> some View {
        if viewModel.isOwner {
            // Owner-only destructive footer. The edit affordance lives in
            // the toolbar so the footer stays single-purpose (destructive).
            Button(role: .destructive) {
                UISelectionFeedbackGenerator().selectionChanged()
                confirmDelete = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "trash")
                        .font(.system(size: 14, weight: .heavy))
                    Text("squads.delete")
                        .font(.system(size: 14, weight: .heavy))
                }
                .foregroundStyle(DSColor.danger)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(Capsule().fill(DSColor.danger.opacity(0.12)))
                .overlay(Capsule().strokeBorder(DSColor.danger.opacity(0.35), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(viewModel.isMutating)
        } else {
            Button(role: .destructive) {
                UISelectionFeedbackGenerator().selectionChanged()
                confirmLeave = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "rectangle.portrait.and.arrow.right")
                        .font(.system(size: 14, weight: .heavy))
                    Text("squads.leave")
                        .font(.system(size: 14, weight: .heavy))
                }
                .foregroundStyle(DSColor.danger)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(Capsule().fill(DSColor.danger.opacity(0.12)))
                .overlay(Capsule().strokeBorder(DSColor.danger.opacity(0.35), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(viewModel.isMutating)
        }
    }

    // MARK: - Helpers

    private func squadPhotoURL(_ raw: String?) -> URL? {
        guard let s = raw, !s.isEmpty, !s.hasPrefix("data:") else { return nil }
        return URL(string: s)
    }

    private func memberPhotoURL(_ raw: String?) -> URL? {
        squadPhotoURL(raw)
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        return parts.joined().isEmpty ? "?" : parts.joined()
    }

    private func firstName(_ name: String) -> String {
        String(name.split(separator: " ").first ?? Substring(name))
    }
}

// MARK: - Game row

/// Compact game row reused inside the detail "this week" list. We don't
/// reach into `Features/Games/MatchesView`'s private `MatchRowCard` (it's
/// owned by another agent), so we render a sibling row with the same
/// information density tuned to the squad context — date headline + venue.
private struct SquadGameRow: View {
    let game: GameSummary

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.16))
                    .frame(width: 38, height: 38)
                Image(systemName: "figure.tennis")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(timeHeadline)
                    .font(.system(size: 14, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(1)
                Text(venueLine)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(DSColor.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            Text(String(format: String(localized: "squads.game.participants_format"),
                        game.participants_count, game.capacity))
                .font(.system(size: 11, weight: .heavy))
                .foregroundStyle(DSColor.textSecondary)
                .monospacedDigit()
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1)
        )
    }

    private var timeHeadline: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = formatter.date(from: game.starts_at)
        if date == nil {
            formatter.formatOptions = [.withInternetDateTime]
            date = formatter.date(from: game.starts_at)
        }
        guard let d = date else { return game.starts_at }
        let display = DateFormatter()
        display.dateStyle = .medium
        display.timeStyle = .short
        return display.string(from: d)
    }

    private var venueLine: String {
        if let v = game.venue_name, !v.isEmpty { return v }
        return String(localized: "squads.game.venue_tbd")
    }
}

// MARK: - Edit sheet

/// Tiny owner-only sheet that edits the squad name and description. We
/// keep this inline (no separate VM file) because the network call is one
/// shot routed through `SquadDetailViewModel.updateSquad` — there's no
/// independent state to manage.
private struct EditSquadSheet: View {
    @State var name: String
    @State var description: String
    var onSave: (String, String) -> Void

    @Environment(\.dismiss) private var dismiss

    init(initialName: String, initialDescription: String,
         onSave: @escaping (String, String) -> Void) {
        self._name = State(initialValue: initialName)
        self._description = State(initialValue: initialDescription)
        self.onSave = onSave
    }

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSave: Bool {
        let len = trimmedName.count
        return len >= 2 && len <= 50
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        nameField
                        descriptionField
                        Spacer().frame(height: 16)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .navigationTitle(Text("squads.edit"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Text("common.cancel")
                            .foregroundStyle(DSColor.textPrimary)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        onSave(trimmedName, description)
                    } label: {
                        Text("common.save")
                            .fontWeight(.heavy)
                            .foregroundStyle(canSave ? DSColor.accent : DSColor.textTertiary)
                    }
                    .disabled(!canSave)
                }
            }
        }
    }

    private var nameField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("squads.field.name")
                .font(.system(size: 12, weight: .heavy))
                .foregroundStyle(DSColor.textTertiary)
            TextField(text: $name) {
                Text("squads.field.name.placeholder")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(DSColor.border.opacity(0.5), lineWidth: 1)
            )
        }
    }

    private var descriptionField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("squads.field.description")
                .font(.system(size: 12, weight: .heavy))
                .foregroundStyle(DSColor.textTertiary)
            ZStack(alignment: .topLeading) {
                if description.isEmpty {
                    Text("squads.field.description.placeholder")
                        .font(.system(size: 14))
                        .foregroundStyle(DSColor.textTertiary)
                        .padding(.horizontal, 4)
                        .padding(.top, 8)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $description)
                    .font(.system(size: 14))
                    .foregroundStyle(DSColor.textPrimary)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 96)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(DSColor.border.opacity(0.5), lineWidth: 1)
            )
        }
    }
}
