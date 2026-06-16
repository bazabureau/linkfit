import SwiftUI
import Observation

/// Modal sheet for assembling and submitting a squad.
struct RegisterSquadSheet: View {
    let tournament: TournamentDetail
    /// Returns `true` when the API accepted the registration, allowing the
    /// parent to dismiss. Failures stay open so the user can edit and retry.
    let onSubmit: (_ squadName: String, _ playerIds: [String]) async -> Bool

    @Environment(AppContainer.self) private var container
    @Environment(\.dismiss) private var dismiss

    @State private var squadName: String = ""
    @State private var picked: [PlayerSummary] = []
    @State private var pickerOpen = false
    @State private var submitting = false
    @State private var errorMessage: String?

    /// `squad_size` includes the captain — invitees are the remainder.
    private var maxInvitees: Int { max(tournament.squad_size - 1, 0) }

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: DSSpacing.md) {
                        header
                        nameField
                        squadSection
                        if let errorMessage {
                            errorBanner(errorMessage)
                        }
                        submitButton
                        Spacer().frame(height: 56)
                    }
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.top, DSSpacing.md)
                }
            }
            .navigationTitle("tournaments.register.title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("common.cancel") { dismiss() }
                        .foregroundStyle(DSColor.textSecondary)
                }
            }
            .sheet(isPresented: $pickerOpen) {
                PlayerPickerSheet(
                    apiClient: container.apiClient,
                    excludedUserIds: Set(picked.map(\.id) + [container.currentUser?.id ?? ""]),
                    remainingSlots: maxInvitees - picked.count
                ) { player in
                    if !picked.contains(where: { $0.id == player.id }), picked.count < maxInvitees {
                        picked.append(player)
                    }
                }
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(.ultraThinMaterial)
    }

    // MARK: - Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
            Text(tournament.name)
                .font(DSType.cardTitle)
                .foregroundStyle(DSColor.textPrimary)
            Text("tournaments.register.subtitle")
                .font(DSType.footnote)
                .foregroundStyle(DSColor.textSecondary)
        }
    }

    private var nameField: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
            Text("tournaments.register.squad_name")
                .font(DSType.metaCaption)
                .foregroundStyle(DSColor.textSecondary)
            TextField("", text: $squadName, prompt: Text("tournaments.register.squad_name.placeholder")
                .foregroundStyle(DSColor.textTertiary))
                .textInputAutocapitalization(.words)
                .foregroundStyle(DSColor.textPrimary)
                .padding(.horizontal, DSSpacing.md)
                .frame(height: 50)
                .background(RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous).fill(DSColor.surface))
                .overlay(RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
        }
    }

    @ViewBuilder
    private var squadSection: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            HStack {
                Text("tournaments.register.players")
                    .font(DSType.metaCaption)
                    .foregroundStyle(DSColor.textSecondary)
                Spacer()
                Text(String(format: String(localized: "tournaments.register.players.count_format"),
                            picked.count + 1, tournament.squad_size))
                    .font(DSType.caption)
                    .foregroundStyle(DSColor.textTertiary)
            }

            // Captain row
            captainRow

            ForEach(picked) { p in
                pickedRow(p)
            }

            if maxInvitees > 0, picked.count < maxInvitees {
                addPlayerButton
            } else if maxInvitees == 0 {
                Text("tournaments.register.solo_only")
                    .font(DSType.caption)
                    .foregroundStyle(DSColor.textTertiary)
                    .padding(.top, DSSpacing.xxs)
            }
        }
        .padding(DSSpacing.md)
        .background(RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: DSRadius.xl, style: .continuous).strokeBorder(DSColor.border, lineWidth: 1))
    }

    private var captainRow: some View {
        HStack(spacing: DSSpacing.sm) {
            ZStack {
                Circle().fill(DSColor.accent)
                Text(initials(container.currentUser?.display_name ?? "?"))
                    .font(DSType.caption2)
                    .foregroundStyle(DSColor.textOnAccent)
            }
            .frame(width: 36, height: 36)

            VStack(alignment: .leading, spacing: 2) {
                Text(container.currentUser?.display_name ?? "—")
                    .font(DSType.bodyStrong)
                    .foregroundStyle(DSColor.textPrimary)
                Text("tournaments.register.you_captain")
                    .font(DSType.caption2)
                    .foregroundStyle(DSColor.textSecondary)
            }
            Spacer()
        }
    }

    private func pickedRow(_ p: PlayerSummary) -> some View {
        HStack(spacing: DSSpacing.sm) {
            ZStack {
                Circle().fill(DSColor.surfaceElevated)
                Text(initials(p.display_name))
                    .font(DSType.caption2)
                    .foregroundStyle(DSColor.textPrimary)
            }
            .frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(p.display_name)
                    .font(DSType.bodyStrong)
                    .foregroundStyle(DSColor.textPrimary)
                if let sport = p.primary_sport {
                    Text(sport.capitalized)
                        .font(DSType.caption2)
                        .foregroundStyle(DSColor.accent)
                }
            }
            Spacer()
            Button {
                Haptics.selection()
                picked.removeAll { $0.id == p.id }
            } label: {
                Image(systemName: "minus.circle.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(DSColor.danger)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("common.remove"))
        }
    }

    private var addPlayerButton: some View {
        Button {
            Haptics.selection()
            pickerOpen = true
        } label: {
            HStack(spacing: DSSpacing.xxs) {
                Image(systemName: "plus.circle.fill")
                Text("tournaments.register.add_player")
            }
            .font(DSType.bodyStrong)
            .foregroundStyle(DSColor.accent)
            .padding(.vertical, DSSpacing.xs)
            .padding(.horizontal, DSSpacing.md)
            .frame(minHeight: 44)
            .background(Capsule().fill(DSColor.accent.opacity(0.14)))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func errorBanner(_ msg: String) -> some View {
        HStack(spacing: DSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(msg).font(DSType.caption)
        }
        .foregroundStyle(DSColor.danger)
        .padding(DSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous).fill(DSColor.danger.opacity(0.10)))
    }

    private var submitButton: some View {
        PrimaryButton(
            title: String(localized: "tournaments.register.cta"),
            icon: "checkmark.circle.fill",
            isLoading: submitting,
            isEnabled: canSubmit
        ) {
            Task { await submit() }
        }
    }

    private var canSubmit: Bool {
        squadName.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2
            && picked.count <= maxInvitees
            && !submitting
    }

    private func submit() async {
        guard canSubmit else { return }
        submitting = true
        errorMessage = nil
        let trimmed = squadName.trimmingCharacters(in: .whitespacesAndNewlines)
        let ok = await onSubmit(trimmed, picked.map(\.id))
        submitting = false
        if !ok {
            errorMessage = String(localized: "tournaments.error.register")
        }
    }

    private func initials(_ name: String) -> String {
        let comps = name.split(separator: " ")
        let chars = comps.prefix(2).compactMap { $0.first }
        return String(chars).uppercased()
    }
}
