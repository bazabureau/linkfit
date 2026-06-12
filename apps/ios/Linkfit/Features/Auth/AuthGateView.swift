import SwiftUI

/// Hosts Login and Register on a single screen so users can toggle between
/// them without losing input.
struct AuthGateView: View {
    @State private var mode: AuthMode = .login
    @State var viewModel: AuthViewModel

    var body: some View {
        ZStack {
            PremiumAuthBackground()

            switch mode {
            case .login:
                LoginView(viewModel: viewModel) {
                    withAnimation(.snappy) { mode = .register }
                    viewModel.formError = nil
                }
                .id(AuthMode.login)
                .transition(.move(edge: .leading).combined(with: .opacity))
            case .register:
                RegisterView(viewModel: viewModel) {
                    withAnimation(.snappy) { mode = .login }
                    viewModel.formError = nil
                }
                .id(AuthMode.register)
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
    }
}
