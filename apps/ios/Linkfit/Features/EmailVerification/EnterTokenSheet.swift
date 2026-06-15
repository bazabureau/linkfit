import SwiftUI

/// Sheet for entering the 6-digit email verification code.
///
/// The backend emails a short numeric code; the user types it (or lets iOS
/// autofill it from Mail via `.oneTimeCode`) into six cells and we submit. When
/// the sixth digit lands we submit automatically. Replaces the old "paste the
/// magic-link token / full URL" flow — there's no token or link surfaced to the
/// user anymore.
struct EnterTokenSheet: View {

    enum CompletionResult { case verified, cancelled }

    let apiClient: APIClient
    let onComplete: (CompletionResult) -> Void

    private static let codeLength = 6

    @State private var viewModel: EmailVerificationViewModel
    @State private var code: String = ""
    @State private var toast: EmailVerificationToast?
    @FocusState private var codeFocused: Bool

    init(apiClient: APIClient,
         onComplete: @escaping (CompletionResult) -> Void) {
        self.apiClient = apiClient
        self.onComplete = onComplete
        _viewModel = State(initialValue: EmailVerificationViewModel(apiClient: apiClient))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.lg) {
                    headerCopy
                    codeField
                    submitButton
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
            .task { codeFocused = true }
        }
    }

    private var headerCopy: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            ZStack {
                Circle().fill(DSColor.accentMuted).frame(width: 52, height: 52)
                Image(systemName: "envelope.open.fill")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                Text("email.sheet.heading")
                    .font(.system(.title3, design: .default, weight: .bold))
                    .foregroundStyle(DSColor.textPrimary)
                Text("email.sheet.subheading")
                    .font(.system(.subheadline, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - 6-digit code field

    /// A real (invisible) text field captures input — keeping `.numberPad` +
    /// `.oneTimeCode` so iOS offers the code from Mail as a QuickType autofill —
    /// while six cells render the digits on top. Tapping anywhere focuses it.
    private var codeField: some View {
        ZStack {
            TextField("", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($codeFocused)
                .foregroundStyle(.clear)
                .tint(.clear)
                .frame(height: 58)
                .onChange(of: code) { _, newValue in
                    let digits = String(newValue.filter(\.isNumber).prefix(Self.codeLength))
                    if digits != code { code = digits }
                    if digits.count == Self.codeLength { submit() }
                }

            HStack(spacing: DSSpacing.xs) {
                ForEach(0..<Self.codeLength, id: \.self) { index in
                    digitCell(index)
                }
            }
            .allowsHitTesting(false)
        }
        .contentShape(Rectangle())
        .onTapGesture { codeFocused = true }
    }

    private func digitCell(_ index: Int) -> some View {
        let chars = Array(code)
        let filled = index < chars.count
        let isFocusCell = index == chars.count && codeFocused
        return RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
            .fill(DSColor.surfaceElevated)
            .frame(maxWidth: .infinity)
            .frame(height: 58)
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                    .strokeBorder(isFocusCell ? DSColor.accent : DSColor.border,
                                  lineWidth: isFocusCell ? 2 : 1)
            )
            .overlay(
                Text(filled ? String(chars[index]) : "")
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .foregroundStyle(DSColor.textPrimary)
                    .contentTransition(.numericText())
            )
            .animation(.snappy(duration: 0.18), value: code)
    }

    private var submitButton: some View {
        PrimaryButton(
            title: String(localized: "email.sheet.submit"),
            icon: "checkmark.seal",
            isLoading: viewModel.isSubmitting,
            isEnabled: code.count == Self.codeLength && !viewModel.isSubmitting,
        ) {
            submit()
        }
    }

    private func submit() {
        guard code.count == Self.codeLength, !viewModel.isSubmitting else { return }
        Task {
            let ok = await viewModel.submitVerification(token: code)
            if ok {
                onComplete(.verified)
            } else {
                // Wrong / expired code — clear so the user can retype fresh.
                code = ""
                codeFocused = true
            }
        }
    }
}
