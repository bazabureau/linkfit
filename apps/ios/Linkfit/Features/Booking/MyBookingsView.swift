import SwiftUI

/// "My Bookings" screen.  Shows upcoming sessions at the top with a Cancel
/// button on each, and past sessions below with their final status.  The
/// view is loaded by the standard `ViewState` flow and refreshable via pull.
struct MyBookingsView: View {
    @State var viewModel: MyBookingsViewModel
    @Environment(\.dismiss) private var dismiss
    /// Booking the user has tapped Cancel on; presence drives the
    /// destructive confirmation dialog. Cleared once the user either
    /// confirms or keeps the booking — the dialog itself never
    /// triggers the cancel call, the destructive button does.
    @State private var pendingCancel: Booking?

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            content
        }
        .navigationTitle("bookings.title")
        .navigationBarTitleDisplayMode(.large)
        .task { await viewModel.load() }
        .refreshable { await viewModel.load() }
        .confirmationDialog(
            Text("bookings.confirm.cancel.title"),
            isPresented: Binding(
                get: { pendingCancel != nil },
                set: { if !$0 { pendingCancel = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingCancel
        ) { booking in
            Button(role: .destructive) {
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
                Task { await viewModel.cancel(booking) }
            } label: { Text("bookings.action.cancel_booking") }
            Button(role: .cancel) {} label: { Text("bookings.action.keep") }
        } message: { _ in
            Text("bookings.confirm.cancel.message")
        }
        // Cancel errors surface as a transient alert so the rest of
        // the list stays on screen — see `MyBookingsViewModel.cancel`.
        .alert(
            Text("game.action.error.title"),
            isPresented: Binding(
                get: { viewModel.actionError != nil },
                set: { if !$0 { viewModel.clearActionError() } }
            ),
            presenting: viewModel.actionError
        ) { _ in
            Button(role: .cancel) { viewModel.clearActionError() } label: {
                Text("common.ok")
            }
        } message: { message in
            Text(message)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView(label: String(localized: "bookings.loading"))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .empty:
            EmptyStateView(
                icon: "calendar.badge.exclamationmark",
                title: String(localized: "bookings.empty.title"),
                message: String(localized: "bookings.empty.message")
            )
            .padding(.horizontal, DSSpacing.lg)
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.load() } }
                .padding(.horizontal, DSSpacing.lg)
        case .loaded(let page):
            loaded(page)
        }
    }

    private func loaded(_ page: BookingsListResponse) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DSSpacing.lg) {
                if !page.upcoming.isEmpty {
                    section(title: "bookings.section.upcoming", bookings: page.upcoming, isUpcoming: true)
                }
                if !page.past.isEmpty {
                    section(title: "bookings.section.past", bookings: page.past, isUpcoming: false)
                }
                Spacer().frame(height: DSSpacing.xl)
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.top, DSSpacing.md)
        }
    }

    private func section(title: LocalizedStringKey, bookings: [Booking], isUpcoming: Bool) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            Text(title)
                .font(.system(.subheadline, design: .default, weight: .heavy))
                .foregroundStyle(DSColor.textSecondary)
                .accessibilityAddTraits(.isHeader)
            ForEach(bookings) { b in
                BookingRow(
                    booking: b,
                    isUpcoming: isUpcoming,
                    isCancelling: viewModel.cancellingId == b.id,
                    onCancel: { pendingCancel = b }
                )
            }
        }
    }
}

/// A single booking card. Differs slightly between upcoming (shows a Cancel
/// button) and past (shows the final status pill).
private struct BookingRow: View {
    let booking: Booking
    let isUpcoming: Bool
    let isCancelling: Bool
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(booking.venue_name)
                        .font(.system(.subheadline, design: .default, weight: .heavy))
                        .foregroundStyle(DSColor.textPrimary)
                    Text(booking.court_name)
                        .font(.system(.caption, design: .default))
                        .foregroundStyle(DSColor.textSecondary)
                }
                Spacer()
                statusPill
            }

            HStack(spacing: DSSpacing.md) {
                Label {
                    Text(formatStart(booking.starts_at))
                        .font(.system(.footnote, design: .default))
                } icon: {
                    Image(systemName: "calendar")
                        .foregroundStyle(DSColor.accent)
                }
                Label {
                    Text(String(format: String(localized: "game.detail.duration_minutes_format"), booking.duration_minutes))
                        .font(.system(.footnote, design: .default))
                } icon: {
                    Image(systemName: "clock")
                        .foregroundStyle(DSColor.accent)
                }
                Spacer()
                Text(BookingPriceFormatter.format(minor: booking.total_minor, currency: booking.currency))
                    .font(.system(.subheadline, design: .default, weight: .heavy))
                    .foregroundStyle(DSColor.accent)
            }
            .foregroundStyle(DSColor.textSecondary)

            if isUpcoming && booking.status != .cancelled {
                Button(action: onCancel) {
                    HStack {
                        if isCancelling {
                            ProgressView().tint(DSColor.danger)
                        } else {
                            Image(systemName: "xmark.circle.fill")
                            Text("bookings.cancel")
                        }
                    }
                    .font(.system(.footnote, design: .default, weight: .bold))
                    .foregroundStyle(DSColor.danger)
                    .frame(maxWidth: .infinity, minHeight: 40)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(DSColor.danger.opacity(0.12))
                    )
                }
                .buttonStyle(.plain)
                .disabled(isCancelling)
            }
        }
        .padding(DSSpacing.md)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
    }

    private var statusPill: some View {
        let (key, color, bg): (LocalizedStringKey, Color, Color) = {
            switch booking.status {
            case .pending_payment:
                return ("bookings.status.pending_payment", DSColor.warning, DSColor.warning.opacity(0.15))
            case .partially_paid:
                return ("bookings.status.partially_paid", DSColor.warning, DSColor.warning.opacity(0.15))
            case .paid:
                return ("bookings.status.paid", DSColor.success, DSColor.success.opacity(0.18))
            case .cancelled:
                return ("bookings.status.cancelled", DSColor.danger, DSColor.danger.opacity(0.12))
            case .refunded:
                return ("bookings.status.refunded", DSColor.textSecondary, DSColor.border)
            case .failed:
                return ("bookings.status.failed", DSColor.danger, DSColor.danger.opacity(0.12))
            }
        }()
        return Text(key)
            .font(.system(.caption2, design: .default, weight: .heavy))
            .foregroundStyle(color)
            .padding(.horizontal, DSSpacing.xs)
            .padding(.vertical, 4)
            .background(Capsule().fill(bg))
    }

    private func formatStart(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return iso }
        let f = DateFormatter()
        f.doesRelativeDateFormatting = true
        f.dateStyle = .medium
        f.timeStyle = .short
        return f.string(from: date)
    }
}

/// Money formatter shared by the booking views in this module.
/// Uses `NumberFormatter.currency` so the symbol placement, separator,
/// and digit grouping follow the user's locale — previously we
/// hard-coded "%.0f ₼" which printed the manat sign even when the
/// booking was billed in USD or EUR. `currencyCode` falls back to AZN
/// for legacy rows that omitted the field on the server.
enum BookingPriceFormatter {
    static func format(minor: Int, currency: String) -> String {
        let code = currency.isEmpty ? "AZN" : currency
        let amount = Decimal(minor) / 100
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = code
        // Drop trailing zeros for clean whole-unit prices (50 ₼ instead
        // of 50,00 ₼) — booking totals are almost always whole majors.
        let fraction = minor % 100
        f.maximumFractionDigits = fraction == 0 ? 0 : 2
        f.minimumFractionDigits = fraction == 0 ? 0 : 2
        if let s = f.string(from: amount as NSDecimalNumber) { return s }
        // Defensive fallback if the locale rejects the currency code.
        let major = Double(minor) / 100.0
        return String(format: fraction == 0 ? "%.0f %@" : "%.2f %@", major, code)
    }
}
