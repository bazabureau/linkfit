import SwiftUI

/// Sheet presented when the user taps "Enter code" on the banner. Lets
/// them paste the magic-link token from their email and submit. We accept
/// both the bare opaque token AND the full link — if the input looks like
/// a URL, we extract the `token` query item before forwarding to the API.
struct EnterTokenSheet: View {

    enum CompletionResult { case verified, cancelled }

    let apiClient: APIClient
    let onComplete: (CompletionResult) -> Void

    @State private var viewModel: EmailVerificationViewModel
    @State private var rawInput: String = ""
    @State private var toast: EmailVerificationToast?
    @FocusState private var inputFocused: Bool

    init(apiClient: APIClient,
         onComplete: @escaping (CompletionResult) -> Void) {
        self.apiClient = apiClient
        self.onComplete = onComplete
        _viewModel = State(initialValue: EmailVerificationViewModel(apiClient: apiClient))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.md) {
                    headerCopy
                    inputField
                    submitButton
                    pasteFromClipboard
                }
                .padding(.horizontal, DSSpacing.lg)
                .padding(.top, DSSpacing.md)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(DSColor.background.ignoresSafeArea())
            .navigationTitle("email.sheet.title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("email.sheet.cancel") { onComplete(.cancelled) }
                        .foregroundStyle(DSColor.textSecondary)
                }
            }
            .overlay(alignment: .top) {
                if let toast {
                    EmailVerificationToastView(toast: toast) {
                        self.toast = nil
                    }
                    .padding(.top, DSSpacing.xs)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.snappy, value: toast)
            .onChange(of: viewModel.lastSubmitFeedback) { _, feedback in
                guard let feedback else { return }
                toast = EmailVerificationToast(
                    title: feedback.titleKey,
                    message: feedback.messageKey,
                    kind: feedback.kind,
                )
            }
            .task { inputFocused = true }
        }
    }

    private var headerCopy: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
            Text("email.sheet.heading")
                .font(.system(.title3, design: .rounded, weight: .bold))
                .foregroundStyle(DSColor.textPrimary)
            Text("email.sheet.subheading")
                .font(.system(.subheadline, design: .rounded))
                .foregroundStyle(DSColor.textSecondary)
        }
    }

    private var inputField: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
            Text("email.sheet.token_label")
                .font(DSType.caption)
                .foregroundStyle(DSColor.textSecondary)
            TextField(String(localized: "email.sheet.token_placeholder"),
                      text: $rawInput,
                      axis: .vertical)
                .lineLimit(2...4)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .focused($inputFocused)
                .padding(.horizontal, DSSpacing.md)
                .padding(.vertical, DSSpacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                        .fill(DSColor.surfaceElevated)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                        .strokeBorder(inputFocused ? DSColor.accent : DSColor.border,
                                      lineWidth: inputFocused ? 1.5 : 1)
                )
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(DSColor.textPrimary)
        }
    }

    private var submitButton: some View {
        PrimaryButton(
            title: String(localized: "email.sheet.submit"),
            icon: "checkmark.seal",
            isLoading: viewModel.isSubmitting,
            isEnabled: !rawInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && !viewModel.isSubmitting,
        ) {
            Task {
                let token = extractToken(from: rawInput)
                let ok = await viewModel.submitVerification(token: token)
                if ok { onComplete(.verified) }
            }
        }
    }

    private var pasteFromClipboard: some View {
        Button(action: pasteFromClipboardAction) {
            Label("email.sheet.paste", systemImage: "doc.on.clipboard")
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .foregroundStyle(DSColor.accent)
                .frame(maxWidth: .infinity, minHeight: 44)
                .overlay(
                    RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                        .stroke(DSColor.accent.opacity(0.4), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private func pasteFromClipboardAction() {
        if let pasted = UIPasteboard.general.string {
            rawInput = pasted
        }
    }

    /// Accept either a bare token or a `linkfit://verify-email?token=…`
    /// URL pasted from the email. Pulling the query item server-side
    /// would also work but feels worse: surface the cleaned token here
    /// so the UI's "Submit" button stays mentally simple.
    private func extractToken(from raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.contains("token=") else { return trimmed }
        if let url = URL(string: trimmed),
           let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
           let token = components.queryItems?.first(where: { $0.name == "token" })?.value {
            return token
        }
        return trimmed
    }
}
