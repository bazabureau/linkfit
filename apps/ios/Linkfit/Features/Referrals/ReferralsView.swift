import SwiftUI
import UIKit

/// Friend-referral hub. The hero shows the user's own 6-character code in a
/// big lime monospaced pill — tap to copy (with haptic), share button to
/// surface the system share sheet (link + SMS-ready text). Below the hero
/// we render the count of friends they've referred so far and a list of
/// referee rows with relative timestamps.
///
/// The screen also surfaces a "Got a code?" CTA which opens the
/// `RedeemCodeSheet` — used post-signup to redeem someone else's code.
///
/// All copy lives in `Localizable.xcstrings` under the "Referrals agent"
/// section so the rest of the app stays translation-ready.
struct ReferralsView: View {
    @State var viewModel: ReferralsViewModel
    @State private var showShareSheet = false
    @State private var showRedeemSheet = false
    @State private var didCopy = false

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.lg) {
                    header
                    content
                    Spacer().frame(height: 120)
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.top, DSSpacing.lg)
            }
            .refreshable { await viewModel.load() }
        }
        .task { await viewModel.load() }
        .sheet(isPresented: $showShareSheet) {
            if case .loaded(let resp) = viewModel.state {
                ReferralsShareSheet(items: [shareText(code: resp.code)])
            }
        }
        .sheet(isPresented: $showRedeemSheet) {
            RedeemCodeSheet(viewModel: viewModel) {
                showRedeemSheet = false
            }
        }
        .overlay(alignment: .top) {
            if let name = viewModel.redeemSuccess {
                redeemBanner(success: true, text: String(format: String(localized: "referrals.redeem.success_format"), name))
                    .onAppear {
                        Haptics.success()
                        Task {
                            try? await Task.sleep(nanoseconds: 3_000_000_000)
                            viewModel.clearRedeemFeedback()
                        }
                    }
            } else if didCopy {
                redeemBanner(success: true, text: String(localized: "referrals.copied"))
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
            Text("referrals.title")
                .font(.system(size: 32, weight: .heavy, design: .rounded))
                .foregroundStyle(DSColor.textPrimary)
            Text("referrals.subtitle")
                .font(DSType.footnote)
                .foregroundStyle(DSColor.textSecondary)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            heroSkeleton
        case .empty:
            heroSkeleton
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.load() } }
                .frame(minHeight: 320)
        case .loaded(let resp):
            VStack(alignment: .leading, spacing: DSSpacing.lg) {
                hero(code: resp.code)
                statsRow(referredCount: resp.referred_count)
                invitedCountTagline(resp.referred_count)
                howItWorks
                redeemCTA
                friendsSection(resp: resp)
            }
        }
    }

    // MARK: - Hero

    private var heroSkeleton: some View {
        VStack(spacing: DSSpacing.md) {
            RoundedRectangle(cornerRadius: 28).fill(DSColor.surface)
                .frame(height: 220)
            RoundedRectangle(cornerRadius: 16).fill(DSColor.surface)
                .frame(height: 64)
        }
        .redacted(reason: .placeholder)
    }

    /// Big rounded card with the code centered in a lime pill. Tap to copy.
    private func hero(code: String) -> some View {
        VStack(spacing: DSSpacing.md) {
            // FAZA 45 §13.1: badge is sentence case, no tracking. Weight carries hierarchy.
            Text("referrals.hero.kicker")
                .font(.system(.caption, design: .rounded, weight: .heavy))
                .foregroundStyle(DSColor.textOnAccent.opacity(0.85))

            Button {
                UIPasteboard.general.string = code
                Haptics.success()
                withAnimation(.easeOut(duration: 0.2)) { didCopy = true }
                Task {
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    withAnimation { didCopy = false }
                }
            } label: {
                Text(code)
                    .font(.system(size: 36, weight: .black, design: .monospaced))
                    .tracking(6)
                    .foregroundStyle(DSColor.textOnAccent)
                    .padding(.vertical, DSSpacing.md)
                    .padding(.horizontal, DSSpacing.xl)
                    .background(
                        Capsule().fill(DSColor.textOnAccent.opacity(0.18))
                    )
                    .overlay(
                        Capsule().strokeBorder(DSColor.textOnAccent.opacity(0.35),
                                               lineWidth: 1.5)
                    )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("referrals.code.accessibility"))
            .accessibilityValue(Text(code))

            Text("referrals.tap_to_copy")
                .font(.system(.footnote, design: .rounded, weight: .semibold))
                .foregroundStyle(DSColor.textOnAccent.opacity(0.75))

            // Two side-by-side action buttons sit beneath the code pill —
            // Kopyala (explicit copy-to-clipboard) on the left and the
            // system share sheet on the right. The Spec calls out both
            // affordances; we surface both so users coming from the share
            // link don't have to discover the tap-on-code-to-copy gesture.
            HStack(spacing: DSSpacing.xs) {
                Button {
                    UIPasteboard.general.string = code
                    Haptics.success()
                    withAnimation(.easeOut(duration: 0.2)) { didCopy = true }
                    Task {
                        try? await Task.sleep(nanoseconds: 2_000_000_000)
                        withAnimation { didCopy = false }
                    }
                } label: {
                    HStack(spacing: DSSpacing.xs) {
                        Image(systemName: "doc.on.doc.fill")
                        Text("referrals.cta.copy")
                    }
                    .font(.system(.subheadline, design: .rounded, weight: .heavy))
                    .foregroundStyle(DSColor.textOnAccent)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .strokeBorder(DSColor.textOnAccent.opacity(0.45),
                                          lineWidth: 1.5)
                    )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("referrals.cta.copy"))

                Button {
                    Haptics.selection()
                    showShareSheet = true
                } label: {
                    HStack(spacing: DSSpacing.xs) {
                        Image(systemName: "square.and.arrow.up.fill")
                        Text("referrals.cta.share")
                    }
                    .font(.system(.subheadline, design: .rounded, weight: .heavy))
                    .foregroundStyle(DSColor.accent)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .background(RoundedRectangle(cornerRadius: 14).fill(DSColor.textOnAccent))
                }
                .buttonStyle(.plain)
            }
            .padding(.top, DSSpacing.xs)
        }
        .padding(.vertical, DSSpacing.xl)
        .padding(.horizontal, DSSpacing.lg)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(DSColor.accent)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .strokeBorder(DSColor.textOnAccent.opacity(0.12), lineWidth: 1)
        )
    }

    // MARK: - Stats row

    private func statsRow(referredCount: Int) -> some View {
        HStack(spacing: DSSpacing.md) {
            statCard(
                icon: "person.2.fill",
                value: "\(referredCount)",
                title: String(localized: "referrals.stats.friends"),
            )
            statCard(
                icon: "rosette",
                value: referredCount > 0 ? String(localized: "referrals.stats.badge_unlocked")
                                         : String(localized: "referrals.stats.badge_locked"),
                title: String(localized: "referrals.stats.badge_title"),
            )
        }
    }

    private func statCard(icon: String, value: String, title: String) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .heavy))
                .foregroundStyle(DSColor.accent)
            Text(value)
                .font(.system(.title2, design: .rounded, weight: .black))
                .foregroundStyle(DSColor.textPrimary)
                .lineLimit(1).minimumScaleFactor(0.7)
            Text(title)
                .font(.system(.caption, design: .rounded))
                .foregroundStyle(DSColor.textTertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(DSSpacing.md)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
            .strokeBorder(DSColor.border, lineWidth: 1))
    }

    // MARK: - Invited-count tagline

    /// Plain "N nəfəri dəvət etmisən" sentence under the stats row. Spec
    /// explicitly calls for this AZ-first count line so the user has a
    /// non-numeric, conversational read of their progress.
    private func invitedCountTagline(_ count: Int) -> some View {
        Text(String(format: String(localized: "referrals.stats.invited_count_format"), count))
            .font(.system(.subheadline, design: .rounded, weight: .heavy))
            .foregroundStyle(DSColor.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, DSSpacing.xs)
    }

    // MARK: - How it works

    /// 3-step "Kodu paylaş → Dost qoşulur → Hər ikiniz Pioneer rozet alır"
    /// strip. Pulled from the assignment spec verbatim. We render as a
    /// vertical stack of three pill rows so the AZ copy doesn't get
    /// squeezed at small Dynamic Type sizes (the carousel layout in
    /// InviteFriendsView is wider — this surface is hosted inside a tab
    /// view with stricter horizontal real estate).
    private var howItWorks: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            Text("referrals.how.title")
                .font(.system(.headline, design: .rounded, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)

            VStack(spacing: DSSpacing.xs) {
                howStep(number: 1,
                        icon: "paperplane.fill",
                        textKey: "referrals.how.step1")
                howStep(number: 2,
                        icon: "person.fill.badge.plus",
                        textKey: "referrals.how.step2")
                howStep(number: 3,
                        icon: "star.circle.fill",
                        textKey: "referrals.how.step3")
            }
        }
    }

    private func howStep(number: Int,
                         icon: String,
                         textKey: LocalizedStringKey) -> some View {
        HStack(spacing: DSSpacing.sm) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.15))
                    .frame(width: 40, height: 40)
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .heavy))
                    .foregroundStyle(DSColor.accent)
            }
            .accessibilityHidden(true)

            Text("\(number)")
                .font(.system(.caption, design: .rounded, weight: .heavy))
                .foregroundStyle(DSColor.textOnAccent)
                .frame(width: 22, height: 22)
                .background(Circle().fill(DSColor.accent))
                .accessibilityHidden(true)

            Text(textKey)
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .foregroundStyle(DSColor.textPrimary)
                .multilineTextAlignment(.leading)

            Spacer(minLength: 0)
        }
        .padding(DSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .strokeBorder(DSColor.border, lineWidth: 1))
    }

    // MARK: - Redeem CTA

    private var redeemCTA: some View {
        Button {
            viewModel.clearRedeemFeedback()
            showRedeemSheet = true
        } label: {
            HStack(spacing: DSSpacing.sm) {
                ZStack {
                    Circle().fill(DSColor.accent.opacity(0.15))
                    Image(systemName: "ticket.fill")
                        .foregroundStyle(DSColor.accent)
                }
                .frame(width: 36, height: 36)

                VStack(alignment: .leading, spacing: 2) {
                    Text("referrals.redeem.row_title")
                        .font(.system(.subheadline, design: .rounded, weight: .heavy))
                        .foregroundStyle(DSColor.textPrimary)
                    Text("referrals.redeem.row_subtitle")
                        .font(.system(.caption, design: .rounded))
                        .foregroundStyle(DSColor.textSecondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .foregroundStyle(DSColor.textTertiary)
            }
            .padding(DSSpacing.md)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(DSColor.surface))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.accent.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Friends list

    private func friendsSection(resp: MyReferralsResponse) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            HStack {
                Text("referrals.list.title")
                    .font(.system(.headline, design: .rounded, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                Spacer()
                Text("\(resp.referred_count)")
                    .font(.system(.footnote, design: .rounded, weight: .semibold))
                    .foregroundStyle(DSColor.textSecondary)
            }
            if resp.referred_users.isEmpty {
                emptyFriendsCard
            } else {
                VStack(spacing: DSSpacing.xs) {
                    ForEach(resp.referred_users) { ReferredFriendRow(friend: $0) }
                }
            }
        }
    }

    private var emptyFriendsCard: some View {
        VStack(spacing: DSSpacing.sm) {
            Image(systemName: "person.crop.circle.badge.plus")
                .font(.system(size: 28))
                .foregroundStyle(DSColor.accent)
            Text("referrals.list.empty.title")
                .font(.system(.subheadline, design: .rounded, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
            Text("referrals.list.empty.message")
                .font(.system(.footnote, design: .rounded))
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.vertical, DSSpacing.xl)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 18).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(DSColor.border, lineWidth: 1))
    }

    // MARK: - Helpers

    /// Body text used in the system share sheet. Mirrors the assignment
    /// spec — Azerbaijani copy plus the linkfit.az/r/<code> deep link so
    /// recipients can tap straight into App Store / the app.
    ///
    /// The format string accepts the code twice (`%1$@` for the human-
    /// readable code, `%2$@` for the same value embedded in the URL) so
    /// localisation files can re-order the two slots if a language reads
    /// better with the link first.
    private func shareText(code: String) -> String {
        String(
            format: String(localized: "referrals.share.body_format"),
            code,
            code,
        )
    }

    private func redeemBanner(success: Bool, text: String) -> some View {
        Text(text)
            .font(.system(.footnote, design: .rounded, weight: .heavy))
            .foregroundStyle(DSColor.textOnAccent)
            .padding(.horizontal, DSSpacing.md)
            .padding(.vertical, DSSpacing.sm)
            .background(Capsule().fill(success ? DSColor.success : DSColor.danger))
            .padding(.top, DSSpacing.lg)
            .transition(.move(edge: .top).combined(with: .opacity))
    }
}

// MARK: - Friend row

struct ReferredFriendRow: View {
    let friend: ReferredUser
    var body: some View {
        HStack(spacing: DSSpacing.sm) {
            avatar
            VStack(alignment: .leading, spacing: 2) {
                Text(friend.display_name)
                    .font(.system(.subheadline, design: .rounded, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                Text(ReferralFormatting.timeAgo(friend.referred_at))
                    .font(.system(.caption, design: .rounded))
                    .foregroundStyle(DSColor.textTertiary)
            }
            Spacer()
            Image(systemName: "checkmark.seal.fill")
                .foregroundStyle(DSColor.accent)
        }
        .padding(DSSpacing.sm)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(DSColor.surface))
    }

    /// Either the user's photo or a monogram fallback. We don't pull
    /// CachedAsyncImage in here to keep this row dependency-free for the
    /// hook integration spec.
    private var avatar: some View {
        ZStack {
            Circle().fill(DSColor.accentMuted)
            Text(initial)
                .font(.system(.subheadline, design: .rounded, weight: .heavy))
                .foregroundStyle(DSColor.accent)
        }
        .frame(width: 40, height: 40)
    }

    private var initial: String {
        let first = friend.display_name.first.map(String.init) ?? "?"
        return first.uppercased()
    }
}

// MARK: - UIKit bridges

/// Thin wrapper around `UIActivityViewController` so we can present from
/// SwiftUI's `.sheet`. Items are typically a single share-text string;
/// iOS picks the best activity (Messages → SMS, Mail, AirDrop, copy, …)
/// based on what the user has installed.
struct ReferralsShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

// MARK: - Date formatting

/// Shared formatting helpers for the referrals screens. Pulled out so
/// `ReferredFriendRow` doesn't need to reach into other features for them.
enum ReferralFormatting {
    static func date(from iso: String) -> Date? {
        let primary = ISO8601DateFormatter()
        primary.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = primary.date(from: iso) { return d }
        let fallback = ISO8601DateFormatter()
        return fallback.date(from: iso)
    }

    static func timeAgo(_ iso: String) -> String {
        guard let d = date(from: iso) else { return "" }
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f.localizedString(for: d, relativeTo: Date())
    }
}
