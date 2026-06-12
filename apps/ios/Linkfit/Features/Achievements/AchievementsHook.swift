import SwiftUI

// MARK: - Achievements integration hook (doc-only)
//
// This file is intentionally MOSTLY DOCUMENTATION. The Achievements agent
// owns `apps/ios/Linkfit/Features/Achievements/**` exclusively; we don't
// touch `ProfileView.swift` or `EditProfileView.swift` because those belong
// to a different agent. Instead, this file documents the exact, copy-pasteable
// snippets the Profile agent should drop into their views to surface badges.
//
// ─────────────────────────────────────────────────────────────────────
// Embedding the "Recently unlocked" carousel inside ProfileView
// ─────────────────────────────────────────────────────────────────────
//
// 1.  Hold a `AchievementsViewModel` alongside the existing `ProfileViewModel`
//     on the view (or its parent). Construct it with the same API client and
//     the same `userId` the profile renders:
//
//         @State private var achievementsVM: AchievementsViewModel
//
//         init(apiClient: APIClient, userId: String, container: AppContainer) {
//             // existing init code…
//             _achievementsVM = State(
//                 wrappedValue: AchievementsViewModel(
//                     apiClient: apiClient, userId: userId
//                 )
//             )
//         }
//
// 2.  Trigger the load alongside the profile fetch:
//
//         .task {
//             await viewModel.load()
//             await achievementsVM.load()
//         }
//
// 3.  Drop the carousel inside the scroll content, between the KPI row and
//     the sports section:
//
//         RecentlyUnlockedCarousel(viewModel: achievementsVM) {
//             // tap-through to the full grid
//             router.push(.achievements(userId: profile.id))
//         }
//
// 4.  In the router (or wherever ProfileView builds its NavigationStack),
//     push `AchievementsView(viewModel: AchievementsViewModel(...))` on tap.
//
// ─────────────────────────────────────────────────────────────────────
// Surfacing from EditProfileView
// ─────────────────────────────────────────────────────────────────────
//
// EditProfileView shouldn't show the carousel — it's a form. Instead, add a
// "Achievements" row in the settings list that navigates to `AchievementsView`
// for the current user. A single SF Symbol row entry is enough.
//
// ─────────────────────────────────────────────────────────────────────
// Sizing & layout guidance
// ─────────────────────────────────────────────────────────────────────
//
// * The carousel renders `BadgeBubble(size: 56)` chips in a horizontal
//   `ScrollView` — small enough to fit 4–5 in the viewport on a 390pt
//   iPhone.
// * Show the recently-unlocked count beside the section header so locked-but-
//   close-to-unlock players still get a "X / 10" social signal.
// * Tap on a chip opens `AchievementDetailSheet`, identical to the one the
//   full grid uses — keep the affordance consistent.

/// Carousel widget the Profile agent embeds. Self-contained: it owns its
/// own scroll view, header, and "see all" affordance. Pass `onSeeAll` to
/// route into `AchievementsView` proper.
///
/// Stays empty (zero height) when the player has nothing unlocked yet so
/// the profile doesn't render a dead section.
struct RecentlyUnlockedCarousel: View {
    @State var viewModel: AchievementsViewModel
    var onSeeAll: () -> Void
    @State private var selected: Achievement?

    var body: some View {
        let items = viewModel.recentlyUnlocked(limit: 8)
        if items.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                HStack {
                    Text(String(localized: "achievements.recently_unlocked"))
                        .font(DSType.sectionTitle)
                        .foregroundStyle(DSColor.textPrimary)
                    Spacer()
                    Button(String(localized: "achievements.see_all"), action: onSeeAll)
                        .font(.system(.subheadline, design: .default, weight: .semibold))
                        .foregroundStyle(DSColor.accent)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: DSSpacing.md) {
                        ForEach(items) { item in
                            Button {
                                selected = item
                            } label: {
                                VStack(spacing: 6) {
                                    BadgeBubble(iconName: item.icon_name,
                                                unlocked: true,
                                                size: 56)
                                    Text(item.name)
                                        .font(DSType.caption2)
                                        .foregroundStyle(DSColor.textSecondary)
                                        .lineLimit(1)
                                        .frame(maxWidth: 64)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .task { await viewModel.onAppear() }
            .sheet(item: $selected) { item in
                AchievementDetailSheet(achievement: item)
                    .presentationDetents([.medium])
                    .presentationDragIndicator(.visible)
            }
        }
    }
}
