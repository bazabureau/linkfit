import SwiftUI

/// Drop-in sheet that lets the user file a moderation report.
///
/// Present it from any screen via `.sheet(item: $reportPayload)` (see
/// `ReportsHook.swift`). Owns its own VM and dismisses itself on submit
/// success — the host only needs to bind the payload state.
///
/// Behavior:
///  - Preset reasons rendered as a radio-style list
///  - Optional `notes` textarea capped client-side at the server limit
///  - Submit fires `.success` haptic on 2xx, `.error` haptic on failure
///  - Auto-dismisses after a brief confirmation flash on success
struct ReportSheet: View {
    @State var viewModel: ReportSheetViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hasFiredSuccess: Bool = false

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                content
                    .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.85),
                               value: viewModel.didSucceed)
            }
            .navigationTitle(Text("reports.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(role: .cancel) {
                        Haptics.selection()
                        dismiss()
                    } label: {
                        Text("reports.cancel")
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(.ultraThinMaterial)
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.didSucceed {
            successCard
                .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.96)))
                .task { await autoDismissAfterSuccess() }
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.lg) {
                    header
                    reasonList
                    notesField
                    if let error = viewModel.errorMessage {
                        HStack(alignment: .firstTextBaseline, spacing: DSSpacing.xs) {
                            Image(systemName: "exclamationmark.circle.fill")
                                .font(DSType.footnote)
                                .foregroundStyle(DSColor.danger)
                            Text(error)
                                .font(DSType.footnote)
                                .foregroundStyle(DSColor.danger)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityElement(children: .combine)
                    }
                    PrimaryButton(
                        title: String(localized: "reports.submit"),
                        isLoading: viewModel.isSubmitting,
                        isEnabled: viewModel.canSubmit
                    ) {
                        Task { await onSubmit() }
                    }
                    .padding(.top, DSSpacing.sm)
                }
                .padding(DSSpacing.lg)
            }
        }
    }

    // MARK: - Pieces

    private var header: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            Text(headerTitleKey)
                .font(DSType.title)
                .foregroundStyle(DSColor.textPrimary)
            Text("reports.subtitle")
                .font(DSType.body)
                .foregroundStyle(DSColor.textSecondary)
        }
    }

    private var headerTitleKey: LocalizedStringKey {
        if let name = viewModel.targetDisplayName, !name.isEmpty {
            return LocalizedStringKey("reports.header.target_named_format \(name)")
        }
        switch viewModel.targetKind {
        case .user:         return "reports.header.user"
        case .game:         return "reports.header.game"
        case .message:      return "reports.header.message"
        case .story:        return "reports.header.story"
        case .feed_event:   return "reports.header.feed_event"
        case .feed_comment: return "reports.header.feed_comment"
        case .venue_review: return "reports.header.venue_review"
        case .media:        return "reports.header.media"
        }
    }

    private var reasonList: some View {
        VStack(spacing: DSSpacing.sm) {
            ForEach(ReportReason.allCases) { reason in
                reasonRow(reason)
            }
        }
    }

    private func reasonRow(_ reason: ReportReason) -> some View {
        let selected = viewModel.selectedReason == reason
        return Button {
            Haptics.selection()
            viewModel.selectedReason = reason
        } label: {
            HStack(spacing: DSSpacing.sm) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(selected ? DSColor.accent : DSColor.textTertiary)
                    .font(.system(size: 22, weight: .regular))
                Text(label(for: reason))
                    .font(DSType.bodyEmphasis)
                    .foregroundStyle(DSColor.textPrimary)
                Spacer(minLength: 0)
            }
            .padding(DSSpacing.md)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: DSRadius.md)
                    .fill(DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.md)
                    .strokeBorder(selected ? DSColor.accent : DSColor.border,
                                  lineWidth: selected ? 1.5 : 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityLabel(Text(label(for: reason)))
    }

    private func label(for reason: ReportReason) -> LocalizedStringKey {
        switch reason {
        case .spam:                   return "reports.reason.spam"
        case .harassment:             return "reports.reason.harassment"
        case .no_show:                return "reports.reason.no_show"
        case .fake_profile:           return "reports.reason.fake_profile"
        case .inappropriate_content:  return "reports.reason.inappropriate_content"
        case .other:                  return "reports.reason.other"
        }
    }

    private var notesField: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            Text("reports.notes.label")
                .font(DSType.caption)
                .foregroundStyle(DSColor.textSecondary)
            // SwiftUI's TextEditor doesn't accept a LocalizedStringKey for
            // its placeholder, so we layer one underneath.
            ZStack(alignment: .topLeading) {
                TextEditor(text: $viewModel.notes)
                    .font(DSType.body)
                    .foregroundStyle(DSColor.textPrimary)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 96)
                    .padding(DSSpacing.sm)
                    .background(
                        RoundedRectangle(cornerRadius: DSRadius.md)
                            .fill(DSColor.surface)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: DSRadius.md)
                            .strokeBorder(DSColor.border, lineWidth: 1)
                    )
                if viewModel.notes.isEmpty {
                    Text("reports.notes.placeholder")
                        .font(DSType.body)
                        .foregroundStyle(DSColor.textTertiary)
                        .padding(.horizontal, DSSpacing.sm + 4)
                        .padding(.vertical, DSSpacing.sm + 8)
                        .allowsHitTesting(false)
                }
            }
            Text(String(format: String(localized: "reports.notes.counter_format"),
                        viewModel.notes.count, ReportSheetViewModel.maxNotesLength))
                .font(DSType.footnote)
                .foregroundStyle(viewModel.notes.count > ReportSheetViewModel.maxNotesLength
                                 ? DSColor.danger : DSColor.textTertiary)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    private var successCard: some View {
        VStack(spacing: DSSpacing.lg) {
            Spacer()
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 56, weight: .regular))
                .foregroundStyle(DSColor.accent)
                .accessibilityHidden(true)
            Text("reports.success.title")
                .font(DSType.title)
                .foregroundStyle(DSColor.textPrimary)
            Text("reports.success.message")
                .font(DSType.body)
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, DSSpacing.lg)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(DSSpacing.lg)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }

    // MARK: - Side effects

    private func onSubmit() async {
        let ok = await viewModel.submit()
        if ok {
            if !hasFiredSuccess {
                hasFiredSuccess = true
                Haptics.success()
            }
        } else {
            Haptics.error()
        }
    }

    private func autoDismissAfterSuccess() async {
        // Brief confirmation flash, then close the sheet.
        try? await Task.sleep(for: .milliseconds(1200))
        dismiss()
    }
}
