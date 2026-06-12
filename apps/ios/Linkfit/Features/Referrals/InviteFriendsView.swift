import SwiftUI
import UIKit
import Observation

// MARK: - View model

/// Drives the Invite Friends screen. Owns the fetched
/// `ReferralShareResponse` (code + URL + pre-rendered localised share copy)
/// in a single `ViewState`. The view never talks to the network — every
/// mutation goes through `load()`.
///
/// Modelled as `@Observable` + `@MainActor`, matching the rest of the app's
/// view-model convention (`ReferralsViewModel`, `MembershipViewModel`, …).
@Observable
@MainActor
final class InviteFriendsViewModel {
    private(set) var state: ViewState<ReferralShareResponse> = .idle

    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    /// Fetch the share payload. Idempotent — safe to call from `.task` and
    /// `.refreshable`. We preserve `.loaded` across pull-to-refresh because
    /// a brief stale-then-fresh transition reads better than flashing a
    /// skeleton over content the user can already see.
    func load() async {
        if case .loaded = state {} else { state = .loading }
        do {
            let resp = try await apiClient.send(.referralShare())
            state = .loaded(resp)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            state = .error(message: error.errorDescription
                           ?? String(localized: "referrals.error.load"))
        } catch {
            state = .error(message: error.localizedDescription)
        }
    }

    /// Pick the share text that matches the device's primary language.
    /// Falls back to the English (`share_text`) variant so the share sheet
    /// is never empty in unexpected locales — better a foreign-language
    /// blurb than a blank `UIActivityViewController`.
    func localisedShareText(for resp: ReferralShareResponse) -> String {
        let language = Locale.current.language.languageCode?.identifier ?? "en"
        switch language {
        case "az": return resp.share_text_az
        case "ru": return resp.share_text_ru
        default:   return resp.share_text
        }
    }
}

// MARK: - View

/// "Invite friends" / share-the-app hub. Hero illustration, a big monospaced
/// code chip, a primary Share CTA that surfaces the system share sheet, and
/// a three-step "How it works" strip below.
///
/// The CTA fetches the personalised share copy from
/// `GET /api/v1/me/referrals/share` once on `.task` and again on pull-to-
/// refresh. Tapping Share presents a `UIActivityViewController` (bridged
/// into SwiftUI via `InviteFriendsShareSheet`) seeded with the locale-
/// matched share text plus the canonical referral URL — iOS then picks
/// the activity (Messages, Mail, WhatsApp, AirDrop, copy, …) based on what
/// the user has installed.
///
/// All copy lives in `Localizable.xcstrings` under the
/// `referrals.hero.*` / `referrals.how.*` / `referrals.action.*` keys so
/// the screen stays fully translation-ready.
///
/// TODO(wiring): expose `InviteFriendsView` from ProfileView (the Profile
/// orphan-wiring agent is editing that file concurrently — we keep our
/// hands off and let the wiring land in a follow-up commit).
struct InviteFriendsView: View {
    @State var viewModel: InviteFriendsViewModel
    @State private var showShareSheet = false
    @State private var didCopy = false

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: DSSpacing.lg) {
                    content
                    Spacer().frame(height: DSSpacing.xxxl)
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.top, DSSpacing.lg)
            }
            .refreshable { await viewModel.load() }
        }
        .navigationTitle(Text("referrals.title"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.load() }
        .sheet(isPresented: $showShareSheet) {
            // The activity controller is rebuilt every time the sheet
            // opens, so we close over the *current* loaded payload. If we
            // hit Share before the response loads, the button is disabled,
            // so this `.loaded` extraction always finds a value.
            if case .loaded(let resp) = viewModel.state {
                InviteFriendsShareSheet(
                    items: [
                        viewModel.localisedShareText(for: resp),
                        URL(string: resp.share_url) as Any
                    ].compactMap { $0 is NSNull ? nil : $0 }
                )
            }
        }
        .overlay(alignment: .top) {
            if didCopy {
                copiedBanner
                    .onAppear {
                        Haptics.success()
                        Task {
                            try? await Task.sleep(nanoseconds: 2_000_000_000)
                            withAnimation { didCopy = false }
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
            skeleton
        case .empty:
            // The API can't return an empty payload — every authenticated
            // user has a code. Treat empty the same as loading so the
            // skeleton stays on screen until something useful arrives.
            skeleton
        case .error(let message):
            ErrorStateView(message: message) { Task { await viewModel.load() } }
                .frame(minHeight: 320)
        case .loaded(let resp):
            VStack(spacing: DSSpacing.lg) {
                hero
                codeCard(code: resp.code)
                shareCTA(enabled: true)
                howItWorks
            }
        }
    }

    // MARK: - Hero

    private var hero: some View {
        VStack(spacing: DSSpacing.sm) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.18))
                    .frame(width: 120, height: 120)
                Image(systemName: "gift.fill")
                    .font(.system(size: 56, weight: .heavy))
                    .foregroundStyle(DSColor.accent)
                    .accessibilityHidden(true)
            }
            .padding(.bottom, DSSpacing.xs)

            Text("referrals.hero.title")
                .font(.system(size: 28, weight: .heavy, design: .rounded))
                .foregroundStyle(DSColor.textPrimary)
                .multilineTextAlignment(.center)

            Text("referrals.hero.subtitle")
                .font(.system(.subheadline, design: .rounded, weight: .regular))
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, DSSpacing.md)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, DSSpacing.md)
    }

    // MARK: - Code card

    /// Big monospaced display of the user's referral code. Tap to copy —
    /// the haptic + toast feedback matches the dashboard's hero card.
    private func codeCard(code: String) -> some View {
        VStack(spacing: DSSpacing.sm) {
            // FAZA 45 §13.1: badge is sentence case, no tracking. Weight carries hierarchy.
            Text("referrals.your_code")
                .font(.system(.caption, design: .rounded, weight: .heavy))
                .foregroundStyle(DSColor.textSecondary)

            Button {
                UIPasteboard.general.string = code
                withAnimation(.easeOut(duration: 0.2)) { didCopy = true }
            } label: {
                Text(code)
                    .font(.system(size: 36, weight: .black, design: .monospaced))
                    .tracking(6)
                    .foregroundStyle(DSColor.accent)
                    .padding(.vertical, DSSpacing.md)
                    .padding(.horizontal, DSSpacing.lg)
                    .frame(maxWidth: .infinity)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(DSColor.accent.opacity(0.10))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(
                                DSColor.accent.opacity(0.35),
                                style: StrokeStyle(lineWidth: 1.5, dash: [6, 4])
                            )
                    )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("referrals.code.accessibility"))
            .accessibilityValue(Text(code))
            .accessibilityHint(Text("referrals.tap_to_copy"))
        }
        .padding(DSSpacing.md)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 24, style: .continuous)
            .fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous)
            .strokeBorder(DSColor.border, lineWidth: 1))
    }

    // MARK: - Share CTA

    private func shareCTA(enabled: Bool) -> some View {
        PrimaryButton(
            title: String(localized: "referrals.action.share"),
            icon: "square.and.arrow.up.fill",
            isEnabled: enabled,
        ) {
            Haptics.selection()
            showShareSheet = true
        }
    }

    // MARK: - How it works

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
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func howStep(number: Int, icon: String, textKey: LocalizedStringKey)
        -> some View {
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

    // MARK: - Skeleton

    private var skeleton: some View {
        VStack(spacing: DSSpacing.lg) {
            RoundedRectangle(cornerRadius: 28).fill(DSColor.surface)
                .frame(height: 220)
            RoundedRectangle(cornerRadius: 18).fill(DSColor.surface)
                .frame(height: 120)
            RoundedRectangle(cornerRadius: 14).fill(DSColor.surface)
                .frame(height: 48)
            VStack(spacing: DSSpacing.xs) {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 16).fill(DSColor.surface)
                        .frame(height: 60)
                }
            }
        }
        .redacted(reason: .placeholder)
    }

    // MARK: - Copied banner

    private var copiedBanner: some View {
        Text("referrals.copied")
            .font(.system(.footnote, design: .rounded, weight: .heavy))
            .foregroundStyle(DSColor.textOnAccent)
            .padding(.horizontal, DSSpacing.md)
            .padding(.vertical, DSSpacing.sm)
            .background(Capsule().fill(DSColor.success))
            .padding(.top, DSSpacing.lg)
            .transition(.move(edge: .top).combined(with: .opacity))
    }
}

// MARK: - UIKit bridge

/// Thin SwiftUI wrapper around `UIActivityViewController` so the system
/// share sheet can be presented from `.sheet`. `items` is typically the
/// localised share text plus the canonical referral URL (in that order —
/// iOS uses the URL for rich-preview activities like Messages while still
/// using the text for SMS / Mail bodies). Activities are not filtered;
/// iOS picks the set based on what the user has installed.
///
/// Named `InviteFriendsShareSheet` so it doesn't collide with
/// `ReferralsShareSheet` already shipped from `ReferralsView.swift` — both
/// wrappers are identical-by-shape but live in their own feature
/// flow, mirroring the rest of the codebase's "one bridge per screen"
/// pattern.
struct InviteFriendsShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
