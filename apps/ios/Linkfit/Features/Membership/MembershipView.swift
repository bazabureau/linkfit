import SwiftUI

/// Three-tier paywall — Free / Plus / Premium — stacked as cards.
///
/// Layout rules:
///   - The user's current tier is highlighted with a lime border + an
///     "Active" pill in the top-right of the card.
///   - The CTA on a non-current card reads "Upgrade to {tier}" in lime
///     when the tier is *above* the user's current tier, and "Switch to
///     {tier}" in surface tone otherwise (downgrade).
///   - The current tier shows a `Cancel subscription` outline button
///     when it's a paid tier and the subscription isn't already
///     scheduled for cancellation.
///
/// Pricing is displayed in AZN (₼) — Free / 9.99 ₼ / 19.99 ₼ per month.
struct MembershipView: View {
    @State var viewModel: MembershipViewModel
    @State private var showCancelConfirm = false
    @State private var toastVisible = false

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            content
        }
        .task { await viewModel.load() }
        .navigationTitle(Text("membership.title"))
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(DSColor.background, for: .navigationBar)
        .alert(Text("membership.cancel.confirm.title"),
               isPresented: $showCancelConfirm) {
            Button(role: .destructive) {
                Task { await viewModel.cancel() }
            } label: { Text("membership.cancel.confirm.action") }
            Button(role: .cancel) {} label: { Text("common.cancel") }
        } message: {
            Text("membership.cancel.confirm.message")
        }
        .overlay(alignment: .top) {
            if toastVisible, let msg = viewModel.lastSuccessMessage {
                toast(message: msg)
                    .padding(.top, DSSpacing.md)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .onChange(of: viewModel.lastSuccessMessage) { _, new in
            if new != nil {
                withAnimation(.easeInOut) { toastVisible = true }
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 2_500_000_000)
                    withAnimation(.easeInOut) {
                        toastVisible = false
                        viewModel.lastSuccessMessage = nil
                    }
                }
            }
        }
    }

    // MARK: - Body switch

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            VStack { Spacer(); LoadingView(); Spacer() }
        case .empty:
            EmptyStateView(
                icon: "creditcard",
                title: String(localized: "membership.empty.title"),
                message: String(localized: "membership.empty.message"),
            )
        case .error(let msg):
            ErrorStateView(message: msg) { Task { await viewModel.load() } }
        case .loaded(let state):
            ScrollView {
                VStack(spacing: DSSpacing.lg) {
                    header(state: state)
                    if let err = viewModel.lastErrorMessage {
                        errorBanner(err)
                    }
                    ForEach(MembershipViewModel.staticCards()) { card in
                        tierCard(card: card, state: state)
                    }
                    Spacer().frame(height: DSSpacing.xl)
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.top, DSSpacing.sm)
            }
            .refreshable { await viewModel.load() }
        }
    }

    // MARK: - Header

    private func header(state: MembershipState) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("membership.header.title")
                .font(.system(size: 26, weight: .heavy, design: .rounded))
                .foregroundStyle(DSColor.textPrimary)
            Text("membership.header.subtitle")
                .font(.system(.subheadline, design: .rounded))
                .foregroundStyle(DSColor.textSecondary)
            if state.cancel_at_period_end, let end = state.current_period_end {
                Text(
                    String(
                        format: String(localized: "membership.header.cancel_scheduled"),
                        formatDate(end),
                    ),
                )
                .font(.system(.footnote, design: .rounded))
                .foregroundStyle(DSColor.warning)
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(DSColor.danger)
            Text(message)
                .font(.system(.footnote, design: .rounded))
                .foregroundStyle(DSColor.textPrimary)
            Spacer(minLength: 0)
            Button { viewModel.lastErrorMessage = nil } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(DSColor.textSecondary)
            }
            .buttonStyle(.plain)
        }
        .padding(DSSpacing.sm)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .fill(DSColor.danger.opacity(0.12)),
        )
    }

    // MARK: - Tier card

    private func tierCard(card: TierCardModel, state: MembershipState) -> some View {
        let isCurrent = card.tier == state.tier
        let benefits: [MembershipBenefit] =
            isCurrent ? state.benefits : BenefitsList.staticBenefits(for: card.tier)
        let isUpgrade = card.tier.rank > state.tier.rank
        let isPaid = card.tier != .free

        return VStack(alignment: .leading, spacing: DSSpacing.md) {
            HStack(spacing: 10) {
                Image(systemName: card.accentSymbol)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(isCurrent ? DSColor.accent : DSColor.textSecondary)
                Text(LocalizedStringKey(card.titleKey))
                    .font(.system(size: 18, weight: .heavy, design: .rounded))
                    .foregroundStyle(DSColor.textPrimary)
                Spacer(minLength: 0)
                if isCurrent {
                    activePill()
                }
            }

            Text(LocalizedStringKey(card.subtitleKey))
                .font(.system(.footnote, design: .rounded))
                .foregroundStyle(DSColor.textSecondary)

            priceRow(minor: card.priceMinor, currency: card.currency)

            BenefitsList(benefits: benefits, tint: isCurrent ? DSColor.accent : DSColor.textSecondary)

            // CTA row — the cancel button only appears under the user's
            // current PAID tier; the upgrade/switch button only appears on
            // other cards.
            if isCurrent && isPaid && !state.cancel_at_period_end {
                SecondaryButton(title: String(localized: "membership.cta.cancel")) {
                    if !viewModel.isMutating { showCancelConfirm = true }
                }
                .opacity(viewModel.isMutating ? 0.5 : 1)
                .allowsHitTesting(!viewModel.isMutating)
            } else if !isCurrent {
                PrimaryButton(
                    title: ctaTitle(for: card.tier, isUpgrade: isUpgrade),
                    isLoading: viewModel.mutatingTier == card.tier,
                    isEnabled: !viewModel.isMutating && card.tier != .free,
                ) {
                    Task { await viewModel.subscribe(to: card.tier) }
                }
            }
        }
        .padding(DSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .fill(isCurrent ? DSColor.accentMuted : DSColor.surface),
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .strokeBorder(
                    isCurrent ? DSColor.accent : DSColor.border,
                    lineWidth: isCurrent ? 2 : 1,
                ),
        )
    }

    private func activePill() -> some View {
        Text("membership.badge.active")
            .font(.system(size: 11, weight: .bold, design: .rounded))
            .foregroundStyle(DSColor.textOnAccent)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(
                Capsule().fill(DSColor.accent),
            )
    }

    private func priceRow(minor: Int, currency: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            if minor == 0 {
                Text("membership.price.free")
                    .font(.system(size: 28, weight: .heavy, design: .rounded))
                    .foregroundStyle(DSColor.textPrimary)
            } else {
                Text(formatPrice(minor: minor, currency: currency))
                    .font(.system(size: 28, weight: .heavy, design: .rounded))
                    .foregroundStyle(DSColor.textPrimary)
                Text("membership.price.per_month")
                    .font(.system(.subheadline, design: .rounded))
                    .foregroundStyle(DSColor.textSecondary)
            }
        }
    }

    private func ctaTitle(for tier: MembershipTier, isUpgrade: Bool) -> String {
        let tierName: String
        switch tier {
        case .plus:    tierName = String(localized: "membership.tier.plus.title")
        case .premium: tierName = String(localized: "membership.tier.premium.title")
        case .free:    tierName = String(localized: "membership.tier.free.title")
        }
        let fmt = isUpgrade
            ? String(localized: "membership.cta.upgrade")
            : String(localized: "membership.cta.switch")
        return String(format: fmt, tierName)
    }

    // MARK: - Helpers

    /// Format `minor` (qəpik) as "9.99 ₼". We don't use `NumberFormatter`
    /// for AZN because the locale-aware glyph placement varies between
    /// `az_AZ` ("9,99 ₼") and `en_US` ("AZN 9.99"); the design spec
    /// pins the manat sign to the right of the digit string, decimal
    /// separator = ".".
    private func formatPrice(minor: Int, currency: String) -> String {
        let major = Double(minor) / 100.0
        let symbol = currency == "AZN" ? "₼" : currency
        return String(format: "%.2f %@", major, symbol)
    }

    /// Format an ISO timestamp as a calendar day in the user's locale.
    private func formatDate(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let date else { return iso }
        let out = DateFormatter()
        out.dateStyle = .medium
        out.timeStyle = .none
        return out.string(from: date)
    }

    // MARK: - Toast

    private func toast(message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(DSColor.accent)
            Text(message)
                .font(.system(.footnote, design: .rounded))
                .foregroundStyle(DSColor.textPrimary)
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, 10)
        .background(
            Capsule().fill(DSColor.surface),
        )
        .overlay(
            Capsule().strokeBorder(DSColor.border, lineWidth: 1),
        )
        .shadow(color: .black.opacity(0.15), radius: 8, y: 4)
    }
}

#Preview {
    let container = AppContainer.live()
    return NavigationStack {
        MembershipView(viewModel: MembershipViewModel(apiClient: container.apiClient))
    }
    .preferredColorScheme(.dark)
}
