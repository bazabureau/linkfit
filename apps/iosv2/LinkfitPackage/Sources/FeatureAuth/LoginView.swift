import SwiftUI
import Models
import DesignSystem

struct LoginView: View {
    private let deps: AuthDependencies
    @State private var vm: LoginViewModel
    @State private var showRegister = false
    @State private var showForgot = false

    init(deps: AuthDependencies) {
        self.deps = deps
        _vm = State(initialValue: LoginViewModel(
            repository: deps.repository,
            social: deps.social,
            onAuthenticated: deps.onAuthenticated
        ))
    }

    var body: some View {
        ZStack {
            AppBackground()
            ScrollView {
                VStack(spacing: DSSpacing.l) {
                    AuthHeader(titleKey: "auth.login.title", subtitleKey: "auth.welcome.subtitle")
                        .padding(.top, DSSpacing.huge)

                    VStack(spacing: DSSpacing.m) {
                        SocialButton(provider: .apple) { Task { await vm.appleTapped() } }
                        if vm.isGoogleAvailable {
                            SocialButton(provider: .google) { Task { await vm.googleTapped() } }
                        }
                    }

                    OrDivider()

                    VStack(spacing: DSSpacing.m) {
                        FloatingTextField("auth.email", text: $vm.email, icon: "envelope.fill",
                                          keyboard: .emailAddress, contentType: .emailAddress, error: vm.emailError)
                        FloatingTextField("auth.password", text: $vm.password, icon: "lock.fill",
                                          isSecure: true, contentType: .password, submitLabel: .go,
                                          error: vm.passwordError) {
                            Task { await vm.submit() }
                        }
                    }

                    if let message = vm.errorMessage {
                        AuthErrorBanner(message: message)
                    }

                    PrimaryButton("auth.login.cta", isLoading: vm.isSubmitting, isEnabled: vm.canSubmit) {
                        Task { await vm.submit() }
                    }

                    Button("auth.forgot") { showForgot = true }
                        .font(DSFont.caption)
                        .foregroundStyle(DSColor.accent)

                    Spacer(minLength: DSSpacing.xl)

                    Button("auth.no_account") { showRegister = true }
                        .font(DSFont.bodySemibold)
                        .foregroundStyle(DSColor.textMuted)
                }
                .padding(.horizontal, DSSpacing.page)
                .padding(.bottom, DSSpacing.xl)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
        }
        .animation(.easeOut(duration: 0.15), value: vm.errorMessage)
        .navigationDestination(isPresented: $showRegister) { RegisterView(deps: deps) }
        .navigationDestination(isPresented: $showForgot) { ForgotPasswordView(deps: deps) }
    }
}
