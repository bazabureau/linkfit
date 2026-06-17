import SwiftUI
import Models
import DesignSystem

struct RegisterView: View {
    private let deps: AuthDependencies
    @State private var vm: RegisterViewModel
    @Environment(\.dismiss) private var dismiss

    init(deps: AuthDependencies) {
        self.deps = deps
        _vm = State(initialValue: RegisterViewModel(
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
                    AuthHeader(titleKey: "auth.register.title", subtitleKey: "auth.welcome.subtitle")
                        .padding(.top, DSSpacing.xl)

                    VStack(spacing: DSSpacing.m) {
                        SocialButton(provider: .apple) { Task { await vm.appleTapped() } }
                        if vm.isGoogleAvailable {
                            SocialButton(provider: .google) { Task { await vm.googleTapped() } }
                        }
                    }

                    OrDivider()

                    VStack(spacing: DSSpacing.m) {
                        FloatingTextField("auth.name", text: $vm.name, icon: "person.fill",
                                          contentType: .name, error: vm.nameError)
                        FloatingTextField("auth.email", text: $vm.email, icon: "envelope.fill",
                                          keyboard: .emailAddress, contentType: .emailAddress, error: vm.emailError)
                        FloatingTextField("auth.password", text: $vm.password, icon: "lock.fill",
                                          isSecure: true, contentType: .newPassword, submitLabel: .go,
                                          error: vm.passwordError) {
                            Task { await vm.submit() }
                        }
                    }

                    if let message = vm.errorMessage {
                        AuthErrorBanner(message: message)
                    }

                    PrimaryButton("auth.register.cta", isLoading: vm.isSubmitting, isEnabled: vm.canSubmit) {
                        Task { await vm.submit() }
                    }

                    Spacer(minLength: DSSpacing.l)

                    Button("auth.have_account") { dismiss() }
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
        .navigationTitle("auth.register.title")
        .navigationBarTitleDisplayMode(.inline)
    }
}
