import SwiftUI
import DesignSystem

struct ForgotPasswordView: View {
    @State private var vm: ForgotPasswordViewModel
    @Environment(\.dismiss) private var dismiss

    init(deps: AuthDependencies) {
        _vm = State(initialValue: ForgotPasswordViewModel(repository: deps.repository))
    }

    var body: some View {
        ZStack {
            AppBackground()
            ScrollView {
                VStack(spacing: DSSpacing.l) {
                    AuthHeader(titleKey: "auth.forgot.title", subtitleKey: "auth.forgot.subtitle")
                        .padding(.top, DSSpacing.huge)

                    if vm.sent {
                        EmptyStateView(
                            icon: "envelope.badge.fill",
                            title: "auth.forgot.title",
                            message: "auth.forgot.sent",
                            actionTitle: "common.continue",
                            action: { dismiss() }
                        )
                    } else {
                        FloatingTextField("auth.email", text: $vm.email, icon: "envelope.fill",
                                          keyboard: .emailAddress, contentType: .emailAddress, submitLabel: .go) {
                            Task { await vm.submit() }
                        }

                        if let message = vm.errorMessage {
                            AuthErrorBanner(message: message)
                        }

                        PrimaryButton("auth.forgot.cta", isLoading: vm.isSubmitting, isEnabled: vm.canSubmit) {
                            Task { await vm.submit() }
                        }
                    }
                }
                .padding(.horizontal, DSSpacing.page)
                .padding(.bottom, DSSpacing.xl)
            }
            .scrollIndicators(.hidden)
        }
        .animation(.easeOut(duration: 0.2), value: vm.sent)
        .navigationTitle("auth.forgot.title")
        .navigationBarTitleDisplayMode(.inline)
    }
}
