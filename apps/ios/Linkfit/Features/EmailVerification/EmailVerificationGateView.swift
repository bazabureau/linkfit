import SwiftUI

/// Hard gate shown over the app whenever the signed-in user's email is not yet
/// verified. Verification is mandatory — a player can hold a session but cannot
/// use the app until they confirm their address from their inbox.
///
/// There is always a way forward (open the link, enter the code, resend) and
/// always a way out (sign out), so no one is ever permanently stuck. The host
/// presents this as a non-dismissable `fullScreenCover`; it tears itself down
/// the moment `/me` reports `email_verified_at` (the host observes that and
/// flips the cover closed).
struct EmailVerificationGateView: View {
    let email: String
    let apiClient: APIClient
    /// Sign out — the host clears the session, which drops us back to the auth
    /// gate and unmounts this cover.
    var onLogout: () -> Void

    @Environment(AppContainer.self) private var container

    @State private var viewModel: EmailVerificationViewModel
    @State private var showEnterToken = false
    @State private var toast: EmailVerificationToast?
    @State private var isRefreshing = false

    init(email: String, apiClient: APIClient, onLogout: @escaping () -> Void) {
        self.email = email
        self.apiClient = apiClient
        self.onLogout = onLogout
        _viewModel = State(initialValue: EmailVerificationViewModel(apiClient: apiClient))
    }

    var body: some View {
        ZStack {
            // Clean canvas + soft brand glow — matches the rebuilt surfaces,
            // not the animated auth mesh.
            DSColor.background.ignoresSafeArea()
            RadialGradient(
                colors: [DSColor.accent.opacity(0.10), .clear],
                center: .top, startRadius: 10, endRadius: 440
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)

            VStack(spacing: 0) {
                Spacer(minLength: DSSpacing.lg)
                hero
                Spacer(minLength: DSSpacing.lg)
                actions
            }
            .padding(.horizontal, DSSpacing.lg)
            .padding(.bottom, DSSpacing.md)
        }
        .sheet(isPresented: $showEnterToken) {
            EnterTokenSheet(apiClient: apiClient) { result in
                showEnterToken = false
                if result == .verified {
                    // Pull fresh /me so the host sees the verified flag and
                    // dismisses the gate.
                    Task { await refresh(announce: false) }
                }
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
            .presentationBackground(.ultraThinMaterial)
        }
        .overlay(alignment: .top) {
            if let toast {
                EmailVerificationToastView(toast: toast) { self.toast = nil }
                    .padding(.top, DSSpacing.sm)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task(id: toast.id) {
                        try? await Task.sleep(nanoseconds: 3_200_000_000)
                        if self.toast?.id == toast.id { self.toast = nil }
                    }
            }
        }
        .animation(.snappy, value: toast)
        .onChange(of: viewModel.lastResendFeedback) { _, fb in
            guard let fb else { return }
            toast = EmailVerificationToast(title: fb.titleKey, message: fb.messageKey, kind: fb.kind)
        }
    }

    // MARK: - Hero

    private var hero: some View {
        VStack(spacing: DSSpacing.md) {
            ZStack {
                Circle().fill(DSColor.accentMuted).frame(width: 100, height: 100)
                Image(systemName: "envelope.badge.fill")
                    .font(.system(size: 42, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }

            VStack(spacing: DSSpacing.xs) {
                Text("email.banner.title")
                    .font(DSType.heroTitle)
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                Text("email.gate.subtitle")
                    .font(DSType.bodyMedium)
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: 2) {
                Text("email.gate.sent_to")
                    .font(DSType.caption)
                    .foregroundStyle(DSColor.textSecondary)
                Text(verbatim: email)
                    .font(DSType.cardTitle)
                    .foregroundStyle(DSColor.accent)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.vertical, DSSpacing.sm)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous).fill(DSColor.surfaceElevated.opacity(0.6)))
            .overlay(RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous).strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1))
        }
    }

    // MARK: - Actions

    private var actions: some View {
        VStack(spacing: DSSpacing.sm) {
            // Primary path: enter the 6-digit code we emailed.
            PrimaryButton(
                title: String(localized: "email.banner.enter_token"),
                icon: "keyboard"
            ) {
                showEnterToken = true
            }

            HStack(spacing: DSSpacing.sm) {
                Button { Task { await viewModel.resendVerification() } } label: {
                    Group {
                        if viewModel.isSending {
                            ProgressView().controlSize(.small).tint(DSColor.accent)
                        } else {
                            Text("email.banner.resend")
                        }
                    }
                    .font(DSType.button)
                    .foregroundStyle(DSColor.accent)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .overlay(Capsule().stroke(DSColor.accent.opacity(0.4), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(viewModel.isSending)

                Button { Task { await refresh(announce: true) } } label: {
                    Group {
                        if isRefreshing {
                            ProgressView().controlSize(.small).tint(DSColor.accent)
                        } else {
                            Text("email.gate.refresh")
                        }
                    }
                    .font(DSType.button)
                    .foregroundStyle(DSColor.accent)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .overlay(Capsule().stroke(DSColor.accent.opacity(0.4), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(isRefreshing)
            }

            Button(role: .destructive) {
                Haptics.soft()
                onLogout()
            } label: {
                Text("email.gate.logout")
                    .font(DSType.button)
                    .foregroundStyle(DSColor.textSecondary)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.plain)
            .padding(.top, DSSpacing.xxs)
        }
    }

    // MARK: - Refresh

    /// Re-fetch `/me`. If the address is now verified the host's observer
    /// dismisses the gate; otherwise (when the user pressed the button) nudge
    /// them that it isn't done yet.
    private func refresh(announce: Bool) async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let me = try await apiClient.send(.me)
            container.updateCurrentUser(me)
            if me.email_verified_at == nil && announce {
                toast = EmailVerificationToast(
                    title: "email.gate.not_verified.title",
                    message: "email.gate.not_verified.message",
                    kind: .info
                )
            } else if me.email_verified_at != nil {
                Haptics.success()
            }
        } catch {
            if announce {
                toast = EmailVerificationToast(
                    title: "email.toast.resend_failed.title",
                    message: "email.toast.resend_failed.message",
                    kind: .error
                )
            }
        }
    }
}
