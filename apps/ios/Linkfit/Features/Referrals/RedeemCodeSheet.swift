import SwiftUI
import UIKit

/// Modal sheet for redeeming a friend's referral code. Single text field
/// uppercases input as the user types, blocks submission until the code
/// length is exactly 6, and fires success / error haptics off the
/// view-model's reported outcome.
///
/// The sheet is reused two ways:
///   - From the Referrals tab via the inline "Got a code?" row.
///   - From the post-signup CTA (see `ReferralsHook.swift`) — the Auth /
///     Settings agent calls `RedeemCodeSheet(viewModel:onClose:)` directly.
///
/// We don't show the dashboard underneath when triggered post-signup; the
/// view-model's `redeem(code:)` reloads the dashboard internally so the next
/// time the user lands on the Referrals tab the count is fresh.
struct RedeemCodeSheet: View {
    @State var viewModel: ReferralsViewModel
    var onClose: () -> Void

    @State private var code: String = ""
    @State private var submitting: Bool = false

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            VStack(spacing: DSSpacing.lg) {
                header
                input
                if let err = viewModel.redeemError {
                    errorBanner(err)
                }
                submitButton
                Spacer()
                footerNote
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.top, DSSpacing.sm)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    // MARK: - Subviews

    private var header: some View {
        VStack(spacing: DSSpacing.xs) {
            ZStack {
                Circle().fill(DSColor.accentMuted)
                Image(systemName: "ticket.fill")
                    .font(.system(size: 28, weight: .heavy))
                    .foregroundStyle(DSColor.accent)
            }
            .frame(width: 72, height: 72)

            Text("referrals.redeem.sheet.title")
                .font(.system(.title2, design: .default, weight: .black))
                .foregroundStyle(DSColor.textPrimary)
            Text("referrals.redeem.sheet.message")
                .font(.system(.subheadline, design: .default))
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, DSSpacing.lg)
    }

    private var input: some View {
        TextField("", text: $code)
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
            .font(.system(size: 28, weight: .black, design: .monospaced))
            .multilineTextAlignment(.center)
            .foregroundStyle(DSColor.textPrimary)
            .padding(.vertical, DSSpacing.md)
            .padding(.horizontal, DSSpacing.lg)
            .background(
                RoundedRectangle(cornerRadius: 18).fill(DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18)
                    .strokeBorder(borderColor, lineWidth: 2)
            )
            .onChange(of: code) { _, newValue in
                // Force uppercase + 6-char cap + strip whitespace so the
                // user can paste a "abc def" code from chat without us
                // tripping over format-check.
                let filtered = newValue
                    .uppercased()
                    .filter { $0.isLetter || $0.isNumber }
                let capped = String(filtered.prefix(6))
                if capped != newValue { code = capped }
                if viewModel.redeemError != nil { viewModel.clearRedeemFeedback() }
            }
            .accessibilityLabel(Text("referrals.redeem.field.accessibility"))
    }

    private var submitButton: some View {
        Button {
            Task { await submit() }
        } label: {
            HStack(spacing: DSSpacing.xs) {
                if submitting { ProgressView().controlSize(.small) }
                Text("referrals.redeem.cta")
            }
            .font(DSType.button)
            .foregroundStyle(DSColor.textOnAccent)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(isValid ? DSColor.accent : DSColor.accent.opacity(0.35))
            )
        }
        .buttonStyle(.plain)
        .disabled(!isValid || submitting)
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: DSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(DSColor.danger)
            Text(message)
                .font(.system(.footnote, design: .default, weight: .semibold))
                .foregroundStyle(DSColor.textPrimary)
            Spacer()
        }
        .padding(DSSpacing.sm)
        .background(RoundedRectangle(cornerRadius: 12).fill(DSColor.danger.opacity(0.12)))
    }

    private var footerNote: some View {
        Text("referrals.redeem.footer")
            .font(.system(.caption2, design: .default))
            .foregroundStyle(DSColor.textTertiary)
            .multilineTextAlignment(.center)
            .padding(.bottom, DSSpacing.md)
    }

    // MARK: - State derivations

    private var isValid: Bool { code.count == 6 }

    private var borderColor: Color {
        if viewModel.redeemError != nil { return DSColor.danger }
        return isValid ? DSColor.accent : DSColor.border
    }

    // MARK: - Submit

    private func submit() async {
        guard isValid, !submitting else { return }
        submitting = true
        defer { submitting = false }
        let ok = await viewModel.redeem(code: code)
        if ok {
            Haptics.success()
            onClose()
        } else {
            Haptics.error()
        }
    }
}
