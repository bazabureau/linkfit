import SwiftUI
import Models
import DesignSystem

/// Generic "section under construction" placeholder, replaced by real feature
/// roots in Phases 2–6.
struct TabPlaceholder: View {
    let titleKey: LocalizedStringKey
    let icon: String

    var body: some View {
        ZStack {
            AppBackground()
            EmptyStateView(
                icon: icon,
                title: titleKey,
                message: "This section is on its way."
            )
        }
        .navigationTitle(titleKey)
    }
}

/// Phase 0 home: greeting + a hint of the design language.
struct HomePlaceholder: View {
    let user: User

    var body: some View {
        ZStack {
            AppBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.section) {
                    VStack(alignment: .leading, spacing: DSSpacing.xs) {
                        Eyebrow("Welcome back")
                        Text(user.displayName)
                            .font(DSFont.hero)
                            .foregroundStyle(DSColor.textPrimary)
                    }

                    VStack(alignment: .leading, spacing: DSSpacing.xs) {
                        Text("Your home feed lands here")
                            .font(DSFont.cardTitle)
                            .foregroundStyle(DSColor.textPrimary)
                        Text("Next game, nearby matches, and quick actions.")
                            .font(DSFont.callout)
                            .foregroundStyle(DSColor.textMuted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .dsCard()
                }
                .padding(.horizontal, DSSpacing.page)
                .padding(.top, DSSpacing.s)
            }
            .scrollIndicators(.hidden)
        }
        .navigationTitle("tab.home")
    }
}

/// Phase 0 profile with a working sign-out so the auth loop is testable.
struct ProfilePlaceholder: View {
    let user: User
    let session: AppSession

    var body: some View {
        ZStack {
            AppBackground()
            VStack(spacing: DSSpacing.l) {
                Avatar(url: user.photoUrl, initials: user.initials, size: 88)
                VStack(spacing: DSSpacing.xxs) {
                    Text(user.displayName)
                        .font(DSFont.section)
                        .foregroundStyle(DSColor.textPrimary)
                    Text(user.email)
                        .font(DSFont.callout)
                        .foregroundStyle(DSColor.textMuted)
                }
                SecondaryButton("Sign out") { session.signOut() }
                    .padding(.horizontal, DSSpacing.jumbo)
                Spacer()
            }
            .padding(.top, DSSpacing.jumbo)
            .padding(.horizontal, DSSpacing.page)
        }
        .navigationTitle("tab.profile")
    }
}

/// Phase 0 signed-out screen. Replaced by `FeatureAuth.AuthRootView` in Phase 1.
struct SignedOutPlaceholder: View {
    var body: some View {
        ZStack {
            AppBackground()
            VStack(spacing: DSSpacing.l) {
                Spacer()
                LogoWordmark(size: 48)
                Text("auth.welcome.subtitle")
                    .font(DSFont.body)
                    .foregroundStyle(DSColor.textMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, DSSpacing.jumbo)
                Spacer()
                Text("Sign in arrives in the next build.")
                    .font(DSFont.caption)
                    .foregroundStyle(DSColor.textDim)
            }
            .padding(.horizontal, DSSpacing.page)
            .padding(.bottom, DSSpacing.jumbo)
        }
    }
}
