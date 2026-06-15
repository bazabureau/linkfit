import SwiftUI

/// Small lime info pill rendered at the top of Home / Profile when the
/// signed-in user's `email_verified_at` is still nil. Self-contained:
/// owns its own view-model, displays toast feedback, and presents the
/// "paste token" sheet from inside the same view tree.
///
/// Integration is intentionally NOT wired here — AuthGate / Home / Profile
/// stay untouched per the agent contract. See `EmailVerificationHook.swift`
/// for the recommended mount pattern.
struct EmailVerificationBanner: View {
    let user: PublicUser
    let apiClient: APIClient
    /// Called after the verification flow successfully completes so the
    /// outer container can refresh `/api/v1/me` and update `currentUser`.
    var onVerified: (() -> Void)?

    @State private var viewModel: EmailVerificationViewModel
    @State private var showsEnterTokenSheet: Bool = false
    @State private var toast: EmailVerificationToast?

    init(user: PublicUser,
         apiClient: APIClient,
         onVerified: (() -> Void)? = nil) {
        self.user = user
        self.apiClient = apiClient
        self.onVerified = onVerified
        _viewModel = State(initialValue: EmailVerificationViewModel(apiClient: apiClient))
    }

    var body: some View {
        // Once the user is verified there's nothing to show — silent unmount.
        if user.email_verified_at != nil {
            EmptyView()
        } else {
            pill
                .sheet(isPresented: $showsEnterTokenSheet) {
                    EnterTokenSheet(
                        apiClient: apiClient,
                        onComplete: { result in
                            showsEnterTokenSheet = false
                            switch result {
                            case .verified:
                                toast = EmailVerificationToast(
                                    title: "email.toast.verified.title",
                                    message: "email.toast.verified.message",
                                    kind: .success,
                                )
                                onVerified?()
                            case .cancelled:
                                break
                            }
                        },
                    )
                    .presentationDetents([.medium])
                    .presentationDragIndicator(.visible)
                }
                .overlay(alignment: .top) {
                    if let toast {
                        EmailVerificationToastView(toast: toast) {
                            self.toast = nil
                        }
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .task(id: toast.id) {
                            try? await Task.sleep(nanoseconds: 3_500_000_000)
                            if self.toast?.id == toast.id { self.toast = nil }
                        }
                    }
                }
                .animation(.snappy, value: toast)
        }
    }

    private var pill: some View {
        // Two rows: title/email on top, the actions on their own full-width
        // row below. Single-row crammed the title + both buttons together and
        // truncated the labels ("Yenidə…", "Kod da…"). Now each button owns
        // half the row and uses minimumScaleFactor instead of truncation, so
        // the text never clips.
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: DSSpacing.sm) {
                Image(systemName: "envelope.badge.fill")
                    .foregroundStyle(DSColor.textOnAccent)
                    .font(.system(size: 16, weight: .semibold))

                VStack(alignment: .leading, spacing: 2) {
                    Text("email.banner.title")
                        .font(.system(.subheadline, design: .default, weight: .semibold))
                        .foregroundStyle(DSColor.textOnAccent)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(verbatim: user.email)
                        .font(.system(.caption, design: .default))
                        .foregroundStyle(DSColor.textOnAccent.opacity(0.75))
                        .lineLimit(1)
                }

                Spacer(minLength: 0)
            }

            HStack(spacing: DSSpacing.xs) {
                Button(action: resend) {
                    Group {
                        if viewModel.isSending {
                            ProgressView()
                                .controlSize(.small)
                                .tint(DSColor.textOnAccent)
                        } else {
                            Text("email.banner.resend")
                                .font(.system(.footnote, design: .default, weight: .semibold))
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 36)
                    .foregroundStyle(DSColor.textOnAccent)
                    .overlay(
                        Capsule().stroke(DSColor.textOnAccent.opacity(0.5), lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
                .disabled(viewModel.isSending)
                .accessibilityLabel("email.banner.resend")

                Button(action: { showsEnterTokenSheet = true }) {
                    Text("email.banner.enter_token")
                        .font(.system(.footnote, design: .default, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity)
                        .frame(height: 36)
                        .foregroundStyle(DSColor.accent)
                        .background(Capsule().fill(DSColor.textOnAccent))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("email.banner.enter_token")
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(DSColor.accent)
        )
        .padding(.horizontal, DSSpacing.md)
        .onChange(of: viewModel.lastResendFeedback) { _, feedback in
            guard let feedback else { return }
            toast = EmailVerificationToast(
                title: feedback.titleKey,
                message: feedback.messageKey,
                kind: feedback.kind,
            )
        }
    }

    private func resend() {
        Task { await viewModel.resendVerification() }
    }
}
