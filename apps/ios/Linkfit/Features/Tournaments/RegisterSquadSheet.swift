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
    }

    // MARK: - Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(tournament.name)
                .font(.system(.headline, design: .default, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
            Text("tournaments.register.subtitle")
                .font(.system(.footnote, design: .default))
                .foregroundStyle(DSColor.textSecondary)
        }
    }

    private var nameField: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("tournaments.register.squad_name")
                .font(.system(.caption, design: .default, weight: .heavy))
                .foregroundStyle(DSColor.textSecondary)
            TextField("", text: $squadName, prompt: Text("tournaments.register.squad_name.placeholder")
                .foregroundStyle(DSColor.textTertiary))
                .textInputAutocapitalization(.words)
                .foregroundStyle(DSColor.textPrimary)
                .padding(.horizontal, DSSpacing.md)
                .frame(height: 50)
                .background(RoundedRectangle(cornerRadius: 14).fill(DSColor.surface))
                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(DSColor.border, lineWidth: 1))
        }
    }

    @ViewBuilder
    private var squadSection: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            HStack {
                Text("tournaments.register.players")
                    .font(.system(.caption, design: .default, weight: .heavy))
                    .foregroundStyle(DSColor.textSecondary)
                Spacer()
                Text(String(format: String(localized: "tournaments.register.players.count_format"),
                            picked.count + 1, tournament.squad_size))
                    .font(.system(.caption, design: .default))
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
                    .font(.system(.caption, design: .default))
                    .foregroundStyle(DSColor.textTertiary)
                    .padding(.top, 4)
            }
        }
        .padding(DSSpacing.md)
        .background(RoundedRectangle(cornerRadius: 18).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(DSColor.border, lineWidth: 1))
    }

    private var captainRow: some View {
        HStack(spacing: DSSpacing.sm) {
            ZStack {
                Circle().fill(DSColor.accent)
                Text(initials(container.currentUser?.display_name ?? "?"))
                    .font(.system(.caption, design: .default, weight: .heavy))
                    .foregroundStyle(DSColor.textOnAccent)
            }
            .frame(width: 36, height: 36)

            VStack(alignment: .leading, spacing: 2) {
                Text(container.currentUser?.display_name ?? "—")
                    .font(.system(.footnote, design: .default, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                Text("tournaments.register.you_captain")
                    .font(.system(.caption2, design: .default))
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
                    .font(.system(.caption, design: .default, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
            }
            .frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(p.display_name)
                    .font(.system(.footnote, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                if let sport = p.primary_sport {
                    Text(sport.capitalized)
                        .font(.system(.caption2, design: .default, weight: .heavy))
                        .foregroundStyle(DSColor.accent)
                }
            }
            Spacer()
            Button {
                picked.removeAll { $0.id == p.id }
            } label: {
                Image(systemName: "minus.circle.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(DSColor.danger)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("common.remove"))
        }
    }

    private var addPlayerButton: some View {
        Button {
            pickerOpen = true
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "plus.circle.fill")
                Text("tournaments.register.add_player")
            }
            .font(.system(.footnote, design: .default, weight: .heavy))
            .foregroundStyle(DSColor.accent)
            .padding(.vertical, 8)
            .padding(.horizontal, DSSpacing.md)
            .background(Capsule().fill(DSColor.accent.opacity(0.14)))
        }
        .buttonStyle(.plain)
    }

    private func errorBanner(_ msg: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(msg).font(.system(.caption, design: .default, weight: .semibold))
        }
        .foregroundStyle(DSColor.danger)
        .padding(DSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(DSColor.danger.opacity(0.10)))
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
