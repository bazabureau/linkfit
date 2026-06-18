import SwiftUI
import Observation

/// Host-only sheet listing the opt-in medical info for confirmed
/// participants in a game. Reachable from `GameDetailView` via the hook
/// pattern described in `MedicalHook.swift` — the Games agent owns the
/// trigger; this file owns the sheet body.
///
/// The backend enforces both host-only access (403 otherwise) and the
/// per-user opt-in (`share_medical_with_host`); the sheet is purely a
/// renderer for the trimmed payload.
struct GameMedicalSheet: View {
    let gameId: String
    @State var viewModel: GameMedicalViewModel
    @Environment(\.dismiss) private var dismiss

    init(gameId: String, apiClient: APIClient) {
        self.gameId = gameId
        _viewModel = State(initialValue: GameMedicalViewModel(apiClient: apiClient))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: DSSpacing.md) {
                        header
                        content
                        Spacer().frame(height: 80)
                    }
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.top, DSSpacing.md)
                }
                .refreshable { await viewModel.load(gameId: gameId) }
            }
            .navigationTitle("medical.host_sheet.title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("common.done") { dismiss() }
                        .foregroundStyle(DSColor.accent)
                }
            }
            .task { await viewModel.load(gameId: gameId) }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(.ultraThinMaterial)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            HStack(spacing: 6) {
                Image(systemName: "cross.case.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
                Text("medical.host_sheet.kicker")
                    .font(.system(.caption, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textSecondary)
            }
            Text("medical.host_sheet.body")
                .font(.system(.footnote))
                .foregroundStyle(DSColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(DSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(DSColor.surfaceElevated)
        )
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.isLoading {
            ProgressView().frame(maxWidth: .infinity, minHeight: 120)
        } else if let err = viewModel.errorMessage {
            VStack(alignment: .leading, spacing: DSSpacing.xs) {
                Text(err)
                    .font(.system(.footnote))
                    .foregroundStyle(DSColor.danger)
                    .fixedSize(horizontal: false, vertical: true)
                if viewModel.canRetry {
                    Button {
                        Task { await viewModel.load(gameId: gameId) }
                    } label: {
                        Text("common.retry")
                            .font(.system(.footnote, design: .default, weight: .semibold))
                            .foregroundStyle(DSColor.accent)
                    }
                }
            }
            .padding(DSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(DSColor.surfaceElevated)
            )
        } else if viewModel.items.isEmpty {
            VStack(spacing: DSSpacing.sm) {
                Image(systemName: "person.crop.circle.badge.questionmark")
                    .font(.system(size: 36, weight: .semibold))
                    .foregroundStyle(DSColor.textTertiary)
                Text("medical.host_sheet.empty.title")
                    .font(.system(.subheadline, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                Text("medical.host_sheet.empty.body")
                    .font(.system(.footnote))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(DSSpacing.lg)
        } else {
            ForEach(viewModel.items) { item in
                participantCard(item)
            }
        }
    }

    private func participantCard(_ p: GameMedicalParticipant) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            Text(p.display_name)
                .font(.system(.headline, design: .default, weight: .semibold))
                .foregroundStyle(DSColor.textPrimary)
            if let phone = p.emergency_contact_phone, !phone.isEmpty {
                infoRow(icon: "phone.fill",
                        label: String(localized: "medical.field.contact_phone"),
                        value: phone,
                        tappable: URL(string: "tel://\(phone.filter { $0.isNumber || $0 == "+" })"))
            }
            if let blood = p.blood_type, !blood.isEmpty {
                infoRow(icon: "drop.fill",
                        label: String(localized: "medical.field.blood_type"),
                        value: blood,
                        tappable: nil)
            }
            if let allergies = p.allergies, !allergies.isEmpty {
                infoRow(icon: "exclamationmark.triangle.fill",
                        label: String(localized: "medical.field.allergies"),
                        value: allergies,
                        tappable: nil)
            }
        }
        .padding(DSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(DSColor.surfaceElevated)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
    }

    @ViewBuilder
    private func infoRow(icon: String, label: String, value: String, tappable: URL?) -> some View {
        HStack(alignment: .top, spacing: DSSpacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(DSColor.accent)
                .frame(width: 22, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(.caption, design: .default))
                    .foregroundStyle(DSColor.textTertiary)
                if let url = tappable {
                    Link(destination: url) {
                        Text(value)
                            .font(.system(.subheadline))
                            .foregroundStyle(DSColor.accent)
                            .underline()
                    }
                    .accessibilityLabel(Text("medical.call_contact"))
                    .accessibilityValue(Text(value))
                } else {
                    Text(value)
                        .font(.system(.subheadline))
                        .foregroundStyle(DSColor.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

@Observable
@MainActor
final class GameMedicalViewModel {
    private(set) var isLoading = false
    private(set) var items: [GameMedicalParticipant] = []
    private(set) var errorMessage: String?
    /// `false` for terminal errors (e.g. 403 not-host) where retrying is
    /// pointless, so the view hides the retry affordance.
    private(set) var canRetry = false
    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    func load(gameId: String) async {
        isLoading = true
        errorMessage = nil
        canRetry = false
        defer { isLoading = false }
        do {
            let summary = try await apiClient.send(
                Endpoint<GameMedicalSummary>.gameMedicalSummary(gameId: gameId)
            )
            items = summary.items
        } catch APIError.forbidden {
            errorMessage = String(localized: "medical.host_sheet.error.not_host")
            canRetry = false
        } catch let e as APIError {
            errorMessage = e.errorDescription ?? String(localized: "medical.host_sheet.error.load")
            canRetry = true
        } catch {
            errorMessage = String(localized: "medical.host_sheet.error.load")
            canRetry = true
        }
    }
}
