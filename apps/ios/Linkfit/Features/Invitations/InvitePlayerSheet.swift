import SwiftUI
import Observation

/// Sheet that lets a host pick a player from an already-loaded list and send
/// them an invitation. The caller (host's game-detail screen) owns the
/// players list so we don't re-fetch — the sheet just renders, filters out
/// participants, and reports the chosen invitee back through `onInvited`.
struct InvitePlayerSheet: View {
    let apiClient: APIClient
    let gameId: String
    /// Already-loaded candidate list (typically from PlayersView or a search).
    let players: [PlayerSummary]
    /// User ids that should be hidden — host id + current participants.
    let excludedUserIds: Set<String>
    /// Fired after the server confirms the invite. Caller can refresh UI.
    let onInvited: (GameInvitation) -> Void

    @State private var query: String = ""
    @State private var selected: PlayerSummary?
    @State private var isSending = false
    @State private var errorMessage: String?
    @Environment(\.dismiss) private var dismiss

    private var filtered: [PlayerSummary] {
        let allowed = players.filter { !excludedUserIds.contains($0.id) }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return allowed }
        return allowed.filter {
            $0.display_name.localizedCaseInsensitiveContains(trimmed)
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                VStack(spacing: DSSpacing.sm) {
                    searchBar
                    content
                    sendButton
                }
                .padding(.top, DSSpacing.sm)
            }
            .navigationTitle("invitations.invite_sheet.title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("common.cancel") { dismiss() }
                        .foregroundStyle(DSColor.textSecondary)
                }
            }
        }
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder
    private var content: some View {
        if filtered.isEmpty {
            EmptyStateView(
                icon: "person.crop.circle.badge.questionmark",
                title: String(localized: "invitations.invite_sheet.empty.title"),
                message: String(localized: "invitations.invite_sheet.empty.message")
            )
            .frame(maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: DSSpacing.xs) {
                    ForEach(filtered) { p in
                        row(p)
                    }
                }
                .padding(.horizontal, DSSpacing.md)
            }
        }
    }

    private var searchBar: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(DSColor.textSecondary)
            TextField("",
                      text: $query,
                      prompt: Text("invitations.invite_sheet.search.placeholder")
                .foregroundStyle(DSColor.textTertiary))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .foregroundStyle(DSColor.textPrimary)
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .fontWeight(.semibold)
                        .foregroundStyle(DSColor.textTertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("common.clear"))
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .frame(height: 48)
        .background(Capsule().fill(DSColor.surface))
        .overlay(Capsule().strokeBorder(DSColor.border, lineWidth: 1))
        .padding(.horizontal, DSSpacing.md)
    }

    private func row(_ p: PlayerSummary) -> some View {
        let isSelected = selected?.id == p.id
        return Button {
            selected = isSelected ? nil : p
        } label: {
            HStack(spacing: DSSpacing.sm) {
                ZStack {
                    Circle().fill(DSColor.surfaceElevated)
                    Text(initials(p.display_name))
                        .font(.system(.caption, design: .default, weight: .heavy))
                        .foregroundStyle(DSColor.textPrimary)
                }
                .frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.display_name)
                        .font(.system(.footnote, design: .default, weight: .semibold))
                        .foregroundStyle(DSColor.textPrimary)
                    if let sport = p.primary_sport, let elo = p.primary_elo {
                        Text("\(sport.capitalized) · ELO \(elo)")
                            .font(.system(.caption2, design: .default))
                            .foregroundStyle(DSColor.textSecondary)
                    }
                }
                Spacer()
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isSelected ? DSColor.accent : DSColor.textTertiary)
            }
            .padding(.horizontal, DSSpacing.sm)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 14)
                .fill(isSelected ? DSColor.accent.opacity(0.10) : DSColor.surface))
            .overlay(RoundedRectangle(cornerRadius: 14)
                .strokeBorder(isSelected ? DSColor.accent : DSColor.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var sendButton: some View {
        VStack(spacing: DSSpacing.xxs) {
            if let errorMessage {
                Text(errorMessage)
                    .font(.system(.caption, design: .default))
                    .foregroundStyle(DSColor.danger)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, DSSpacing.md)
            }
            Button {
                Task { await send() }
            } label: {
                HStack(spacing: 6) {
                    if isSending {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "paperplane.fill")
                    }
                    Text("invitations.invite_sheet.send")
                }
                .font(.system(.subheadline, design: .default, weight: .heavy))
                .foregroundStyle(DSColor.textOnAccent)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(RoundedRectangle(cornerRadius: 16)
                    .fill(selected == nil ? DSColor.accent.opacity(0.4) : DSColor.accent))
            }
            .buttonStyle(.plain)
            .disabled(selected == nil || isSending)
            .padding(.horizontal, DSSpacing.md)
            .padding(.bottom, DSSpacing.md)
        }
    }

    private func send() async {
        guard let target = selected, !isSending else { return }
        isSending = true
        errorMessage = nil
        defer { isSending = false }
        do {
            let inv = try await apiClient.send(
                .createGameInvitation(gameId: gameId, inviteeUserId: target.id)
            )
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onInvited(inv)
            dismiss()
        } catch let error as APIError {
            errorMessage = error.errorDescription
                          ?? String(localized: "invitations.invite_sheet.error")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func initials(_ name: String) -> String {
        let comps = name.split(separator: " ")
        let chars = comps.prefix(2).compactMap { $0.first }
        return String(chars).uppercased()
    }
}
