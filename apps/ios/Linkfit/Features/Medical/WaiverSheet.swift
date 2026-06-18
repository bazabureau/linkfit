import SwiftUI
import Observation

/// One-time waiver acknowledgment sheet. Shown before tournament register —
/// the calling agent (Tournaments) wires this in front of its own register
/// CTA. We return success via `onSigned()` so the parent can proceed to the
/// register sheet immediately.
struct WaiverSheet: View {
    let tournamentId: String
    let tournamentName: String
    /// Callback fired after a successful sign-waiver POST. The waiver
    /// endpoint is idempotent, so re-shown sheets that the user signs again
    /// still funnel through this callback exactly once per Sign tap.
    let onSigned: () -> Void

    @State var viewModel: WaiverViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var agreed = false

    init(
        tournamentId: String,
        tournamentName: String,
        apiClient: APIClient,
        onSigned: @escaping () -> Void,
    ) {
        self.tournamentId = tournamentId
        self.tournamentName = tournamentName
        self.onSigned = onSigned
        _viewModel = State(initialValue: WaiverViewModel(apiClient: apiClient))
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                DSColor.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: DSSpacing.md) {
                        header
                        termsBox
                        agreeRow
                        if let err = viewModel.errorMessage {
                            Text(err)
                                .font(.system(.footnote))
                                .foregroundStyle(DSColor.danger)
                        }
                        Spacer().frame(height: 120)
                    }
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.top, DSSpacing.md)
                }

                signBar
            }
            .navigationTitle("waiver.title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("common.cancel") { dismiss() }
                        .foregroundStyle(DSColor.textSecondary)
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(.ultraThinMaterial)
    }

    // MARK: - Pieces

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("waiver.header.kicker")
                .font(.system(.caption, design: .default, weight: .semibold))
                .foregroundStyle(DSColor.accent)
            Text(tournamentName)
                .font(.system(.title2, design: .default, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
            Text("waiver.header.subtitle")
                .font(.system(.footnote))
                .foregroundStyle(DSColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// The terms block is a scroll view because waiver copy can be longer
    /// than a fold — we still want the agree checkbox + Sign CTA in view at
    /// all times. Vertical max height is fixed so the layout doesn't push
    /// the CTA off-screen on small devices.
    private var termsBox: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                Text("waiver.terms.heading_1")
                    .font(.system(.subheadline, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                Text("waiver.terms.body_1")
                    .font(.system(.footnote))
                    .foregroundStyle(DSColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                Text("waiver.terms.heading_2")
                    .font(.system(.subheadline, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                    .padding(.top, DSSpacing.xs)
                Text("waiver.terms.body_2")
                    .font(.system(.footnote))
                    .foregroundStyle(DSColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                Text("waiver.terms.heading_3")
                    .font(.system(.subheadline, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                    .padding(.top, DSSpacing.xs)
                Text("waiver.terms.body_3")
                    .font(.system(.footnote))
                    .foregroundStyle(DSColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(DSSpacing.md)
        }
        .frame(maxHeight: 260)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(DSColor.surfaceElevated)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
    }

    private var agreeRow: some View {
        Button {
            agreed.toggle()
            Haptics.selection()
        } label: {
            HStack(spacing: DSSpacing.sm) {
                Image(systemName: agreed ? "checkmark.square.fill" : "square")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(agreed ? DSColor.accent : DSColor.textTertiary)
                Text("waiver.agree.label")
                    .font(.system(.footnote, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.leading)
                Spacer()
            }
            .padding(DSSpacing.md)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(DSColor.surfaceElevated)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(
                        agreed ? DSColor.accent : DSColor.border,
                        lineWidth: agreed ? 1.5 : 1,
                    )
            )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isButton)
        .accessibilityValue(agreed ? Text("common.on") : Text("common.off"))
    }

    private var signBar: some View {
        VStack(spacing: 0) {
            PrimaryAuthButton(
                titleKey: "waiver.sign",
                isLoading: viewModel.isSubmitting,
                isEnabled: agreed && !viewModel.isSubmitting
            ) {
                Task {
                    let ok = await viewModel.sign(tournamentId: tournamentId)
                    if ok {
                        Haptics.success()
                        onSigned()
                        dismiss()
                    } else {
                        Haptics.error()
                    }
                }
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.bottom, DSSpacing.md)
        }
        .background(
            LinearGradient(colors: [DSColor.background.opacity(0), DSColor.background],
                           startPoint: .top, endPoint: .bottom)
                .frame(height: 140)
                .allowsHitTesting(false),
            alignment: .bottom,
        )
    }
}

/// Tiny VM — the only state is the in-flight request + the last error.
@Observable
@MainActor
final class WaiverViewModel {
    private(set) var isSubmitting = false
    private(set) var errorMessage: String?
    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    func sign(tournamentId: String) async -> Bool {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            _ = try await apiClient.send(
                Endpoint<WaiverSignResponse>.signTournamentWaiver(tournamentId: tournamentId)
            )
            return true
        } catch let e as APIError {
            errorMessage = e.errorDescription ?? String(localized: "waiver.error.sign_failed")
            return false
        } catch {
            errorMessage = String(localized: "waiver.error.sign_failed")
            return false
        }
    }
}
