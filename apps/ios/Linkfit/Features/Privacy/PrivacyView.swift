import SwiftUI

/// GDPR / privacy hub. Two responsibilities:
///
/// 1. **Data export** — kick off a server-side export job, poll until
///    the worker writes the artifact to storage, then surface the
///    download URL. We hand the URL off to `UIApplication.shared.open`
///    so Safari handles the actual download (matches the Membership
///    Stripe-Checkout flow and avoids us hosting an in-app browser).
///
/// 2. **Account deletion** — schedule a 30-day grace-window deletion or
///    cancel a pending one. Both gestures are destructive and
///    irreversible past the grace window, so we gate the schedule
///    action behind a `confirmationDialog` that explains the policy.
///
/// All copy is keyed into `Localizable.xcstrings` (az / en / ru); no
/// raw English strings render in the view body.
struct PrivacyView: View {
    @Environment(AppContainer.self) private var container
    @State private var viewModel: PrivacyViewModel?
    @State private var confirmDelete = false

    var body: some View {
        Form {
            if let vm = viewModel {
                dataExportSection(vm: vm)
                deletionSection(vm: vm)
            }
        }
        .scrollContentBackground(.hidden)
        .background(DSColor.background.ignoresSafeArea())
        .navigationTitle(Text("privacy.title"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if viewModel == nil {
                viewModel = PrivacyViewModel(apiClient: container.apiClient)
            }
            await viewModel?.load()
        }
        .onDisappear {
            // Cancel the 5 s poller when the user backs out — otherwise
            // it keeps polling under a screen that's no longer visible.
            viewModel?.tearDown()
        }
        .confirmationDialog(
            Text("privacy.delete.confirm.title"),
            isPresented: $confirmDelete,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await viewModel?.scheduleDeletion() }
            } label: {
                Text("privacy.delete.cta")
            }
            Button(role: .cancel) {} label: {
                Text("common.cancel")
            }
        } message: {
            Text("privacy.delete.confirm.message")
        }
        .alert(
            Text("common.error_title"),
            isPresented: Binding(
                get: { viewModel?.exportError != nil },
                set: { if !$0 { viewModel?.clearExportError() } }
            ),
            presenting: viewModel?.exportError
        ) { _ in
            Button("common.ok", role: .cancel) {
                viewModel?.clearExportError()
            }
        } message: { msg in
            Text(verbatim: msg)
        }
        .alert(
            Text("common.error_title"),
            isPresented: Binding(
                get: { viewModel?.deletionError != nil },
                set: { if !$0 { viewModel?.clearDeletionError() } }
            ),
            presenting: viewModel?.deletionError
        ) { _ in
            Button("common.ok", role: .cancel) {
                viewModel?.clearDeletionError()
            }
        } message: { msg in
            Text(verbatim: msg)
        }
    }

    // MARK: - Data export

    @ViewBuilder
    private func dataExportSection(vm: PrivacyViewModel) -> some View {
        Section {
            if vm.exportReady, let url = vm.exportDownloadURL {
                // Ready to download — primary CTA opens Safari with the
                // signed URL. We show a footer with the expiry so the
                // user knows the link is time-bounded.
                Button {
                    Haptics.selection()
                    UIApplication.shared.open(url)
                } label: {
                    HStack(spacing: 12) {
                        iconBadge("arrow.down.doc.fill", tint: DSColor.accent)
                        Text("privacy.action.download_export")
                            .font(.system(.body, weight: .semibold))
                            .foregroundStyle(DSColor.textPrimary)
                        Spacer()
                        Image(systemName: "arrow.up.right.square")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(DSColor.textTertiary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                // "Re-request" — once the user has a ready export, they
                // can still ask for a fresh one. Same action, just a
                // secondary visual treatment so we don't compete with
                // the download CTA above.
                Button {
                    Haptics.selection()
                    Task { await vm.requestExport() }
                } label: {
                    rowLabel(icon: "arrow.clockwise",
                             titleKey: "privacy.action.request_export",
                             tint: DSColor.textSecondary)
                }
                .buttonStyle(.plain)
                .disabled(vm.exportInFlight)

            } else if vm.exportPending || vm.exportInFlight {
                // Either we just POSTed or the poller saw a still-pending
                // record on load. Either way: spinner row, no actions.
                HStack(spacing: 12) {
                    iconBadge("clock.arrow.circlepath", tint: DSColor.accent)
                    Text("privacy.export.pending")
                        .font(.system(.body, weight: .medium))
                        .foregroundStyle(DSColor.textPrimary)
                    Spacer()
                    ProgressView()
                        .controlSize(.small)
                }

            } else {
                // No export record (or last one failed/expired) — show
                // the primary CTA.
                Button {
                    Haptics.selection()
                    Task { await vm.requestExport() }
                } label: {
                    rowLabel(icon: "square.and.arrow.down",
                             titleKey: "privacy.action.request_export",
                             tint: DSColor.accent)
                }
                .buttonStyle(.plain)
                .disabled(vm.exportInFlight)
            }
        } header: {
            sectionHeader("privacy.section.data_export")
        } footer: {
            if vm.exportReady, let expiresRaw = vm.export?.expires_at,
               let date = isoDate(expiresRaw) {
                Text("privacy.export.ready_format \(date.formatted(date: .abbreviated, time: .shortened))")
                    .font(DSType.metaCaption)
                    .foregroundStyle(DSColor.textTertiary)
            }
        }
        .listRowBackground(DSColor.surface)
    }

    // MARK: - Account deletion

    @ViewBuilder
    private func deletionSection(vm: PrivacyViewModel) -> some View {
        Section {
            if vm.hasPendingDeletion {
                // Pending state — render the hard-delete date and offer a
                // cancel button. Date is parsed from the ISO timestamp.
                if let hardDate = vm.hardDeleteDate {
                    HStack(spacing: 12) {
                        iconBadge("hourglass", tint: DSColor.danger)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("privacy.delete.scheduled_format \(hardDate.formatted(date: .long, time: .omitted))")
                                .font(.system(.body, weight: .semibold))
                                .foregroundStyle(DSColor.textPrimary)
                        }
                        Spacer()
                    }
                }

                Button {
                    Haptics.selection()
                    Task { await vm.cancelDeletion() }
                } label: {
                    HStack {
                        Spacer()
                        if vm.deletionInFlight {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("privacy.delete.cancel")
                                .font(.system(.body, weight: .semibold))
                                .foregroundStyle(DSColor.accent)
                        }
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .disabled(vm.deletionInFlight)

            } else {
                // No pending request — destructive CTA. The dialog body
                // explains the 30-day grace window.
                Button(role: .destructive) {
                    Haptics.selection()
                    confirmDelete = true
                } label: {
                    HStack {
                        Spacer()
                        if vm.deletionInFlight {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("privacy.delete.cta")
                                .font(.system(.body, weight: .semibold))
                                .foregroundStyle(DSColor.danger)
                        }
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .disabled(vm.deletionInFlight)
            }
        } header: {
            sectionHeader("privacy.section.deletion")
        }
        .listRowBackground(DSColor.surface)
    }

    // MARK: - Row primitives
    //
    // Inlined here (not factored into a shared component) because the
    // Settings hub already has its own slightly-different row style and
    // forcing a single component would couple the two unrelated screens.

    private func rowLabel(
        icon: String,
        titleKey: LocalizedStringKey,
        tint: Color
    ) -> some View {
        HStack(spacing: 12) {
            iconBadge(icon, tint: tint)
            Text(titleKey)
                .font(.system(.body, weight: .medium))
                .foregroundStyle(DSColor.textPrimary)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(DSColor.textTertiary)
        }
        .contentShape(Rectangle())
    }

    private func iconBadge(_ name: String, tint: Color) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(tint.opacity(0.16))
                .frame(width: 28, height: 28)
            Image(systemName: name)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tint)
        }
    }

    private func sectionHeader(_ key: LocalizedStringKey) -> some View {
        // FAZA 45 §13.1: no uppercase + no tracking. Weight carries hierarchy.
        Text(key)
            .font(DSType.badge)
            .foregroundStyle(DSColor.textSecondary)
    }

    /// Local ISO parser for footer copy. Mirrors the one in the view
    /// model but the view doesn't get to reach into the VM's private
    /// formatter — keeping the two independent means the formatter
    /// options can drift if the API gains a different precision.
    private func isoDate(_ raw: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = f.date(from: raw) { return date }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: raw)
    }
}
