import SwiftUI

/// Optional medical / emergency profile form. Visible only to the owner;
/// data is shown to game hosts only if `shareWithHosts` is enabled.
///
/// Trigger surface lives in Settings/Profile (see `MedicalHook.swift`) —
/// the entry point itself is owned by those modules so this file never
/// reaches into navigation it doesn't own.
struct MedicalProfileView: View {
    @State var viewModel: MedicalProfileViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var savedToastVisible = false

    var body: some View {
        ZStack(alignment: .bottom) {
            DSColor.background.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.lg) {
                    privacyHeader
                    if viewModel.isLoading {
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 120)
                    } else if let err = viewModel.loadError {
                        ErrorBanner(message: err) {
                            Task { await viewModel.load() }
                        }
                    } else {
                        emergencyContactSection
                        medicalDetailsSection
                        sharingSection
                    }
                    Spacer().frame(height: 120)
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.top, DSSpacing.md)
            }
            .scrollDismissesKeyboard(.interactively)

            submitBar
                .ignoresSafeArea(.keyboard, edges: .bottom)
        }
        .navigationTitle("medical.title")
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.load() }
        .overlay(alignment: .top) {
            if savedToastVisible {
                SavedToast()
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .padding(.top, DSSpacing.sm)
            }
        }
    }

    // MARK: - Sections

    /// Polite header reassuring the user the data is private. We
    /// intentionally place this above any input so the assurance is the
    /// first thing they read.
    private var privacyHeader: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            HStack(spacing: DSSpacing.xs) {
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
                Text("medical.privacy.title")
                    .font(.system(.subheadline, design: .rounded, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
            }
            Text("medical.privacy.body")
                .font(.system(.footnote, design: .default))
                .foregroundStyle(DSColor.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(DSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(DSColor.surfaceElevated)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
    }

    private var emergencyContactSection: some View {
        sectionShell(title: String(localized: "medical.section.emergency_contact")) {
            VStack(spacing: DSSpacing.sm) {
                FloatingTextField(
                    labelKey: "medical.field.contact_name",
                    icon: "person.fill",
                    text: $viewModel.emergencyContactName,
                    contentType: .name,
                    autocapitalization: .words
                )
                FloatingTextField(
                    labelKey: "medical.field.contact_phone",
                    icon: "phone.fill",
                    text: $viewModel.emergencyContactPhone,
                    keyboard: .phonePad,
                    contentType: .telephoneNumber
                )
            }
        }
    }

    private var medicalDetailsSection: some View {
        sectionShell(title: String(localized: "medical.section.medical_details")) {
            VStack(spacing: DSSpacing.sm) {
                FloatingTextField(
                    labelKey: "medical.field.blood_type",
                    icon: "drop.fill",
                    text: $viewModel.bloodType,
                    autocapitalization: .characters
                )
                multilineField(
                    title: String(localized: "medical.field.allergies"),
                    placeholder: String(localized: "medical.field.allergies.placeholder"),
                    text: $viewModel.allergies,
                )
                multilineField(
                    title: String(localized: "medical.field.conditions"),
                    placeholder: String(localized: "medical.field.conditions.placeholder"),
                    text: $viewModel.conditions,
                )
                multilineField(
                    title: String(localized: "medical.field.medications"),
                    placeholder: String(localized: "medical.field.medications.placeholder"),
                    text: $viewModel.medications,
                )
            }
        }
    }

    private var sharingSection: some View {
        sectionShell(title: String(localized: "medical.section.sharing")) {
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                Toggle(isOn: $viewModel.shareWithHosts) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("medical.sharing.toggle")
                            .font(.system(.subheadline, design: .rounded, weight: .semibold))
                            .foregroundStyle(DSColor.textPrimary)
                        Text("medical.sharing.helper")
                            .font(.system(.caption, design: .default))
                            .foregroundStyle(DSColor.textTertiary)
                    }
                }
                .tint(DSColor.accent)
                .padding(DSSpacing.md)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(DSColor.surfaceElevated)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(DSColor.border, lineWidth: 1)
                )
            }
        }
    }

    // MARK: - Multiline helper

    private func multilineField(title: String, placeholder: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
            Text(title)
                .font(DSType.caption)
                .foregroundStyle(DSColor.textSecondary)
            ZStack(alignment: .topLeading) {
                if text.wrappedValue.isEmpty {
                    Text(placeholder)
                        .font(.system(.body, design: .default))
                        .foregroundStyle(DSColor.textTertiary)
                        .padding(.horizontal, DSSpacing.md + 4)
                        .padding(.vertical, DSSpacing.sm + 2)
                }
                TextEditor(text: text)
                    .font(.system(.body, design: .default))
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.vertical, DSSpacing.sm)
                    .frame(minHeight: 90)
            }
            .background(
                RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                    .fill(DSColor.surfaceElevated)
            )
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                    .strokeBorder(DSColor.border, lineWidth: 1)
            )
        }
    }

    // MARK: - Submit bar

    private var submitBar: some View {
        VStack(spacing: 0) {
            if let err = viewModel.formError {
                Text(err)
                    .font(.system(.footnote))
                    .foregroundStyle(DSColor.danger)
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.bottom, DSSpacing.xs)
            }
            PrimaryAuthButton(
                titleKey: "medical.save",
                isLoading: viewModel.isSubmitting,
                isEnabled: !viewModel.isSubmitting && !viewModel.isLoading
            ) {
                Task {
                    let ok = await viewModel.save()
                    if ok {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                            savedToastVisible = true
                        }
                        try? await Task.sleep(nanoseconds: 1_400_000_000)
                        withAnimation { savedToastVisible = false }
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

    // MARK: - Helpers

    private func sectionShell<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content,
    ) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            Text(title)
                .font(.system(.caption, design: .rounded, weight: .semibold))
                .foregroundStyle(DSColor.textSecondary)
                .padding(.leading, 4)
            content()
        }
    }
}

// MARK: - Tiny helpers

private struct ErrorBanner: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            Text(message)
                .font(.system(.footnote))
                .foregroundStyle(DSColor.danger)
            Button(action: retry) {
                Text("common.retry")
                    .font(.system(.footnote, design: .rounded, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
        }
        .padding(DSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(DSColor.surfaceElevated)
        )
    }
}

private struct SavedToast: View {
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(DSColor.accent)
            Text("medical.saved")
                .font(.system(.footnote, design: .rounded, weight: .semibold))
                .foregroundStyle(DSColor.textPrimary)
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.xs)
        .background(Capsule().fill(DSColor.surfaceElevated))
        .overlay(Capsule().strokeBorder(DSColor.border, lineWidth: 1))
    }
}
