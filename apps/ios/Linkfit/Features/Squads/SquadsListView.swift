import SwiftUI

/// The root of the Squads feature — landing screen when the user taps
/// "Mənim squadlarım" on their profile. Lists every squad they belong to
/// (owner or member) with a photo, name, member count, and a teaser for
/// the next upcoming game where 2+ squad members participate.
///
/// Empty-state is the priority surface: a brand-new user has no squads,
/// and the screen needs to make the "create one" CTA unmissable so the
/// feature actually gets used. We render a large illustration + heading +
/// supporting copy + a big lime PrimaryButton — same vocabulary as the
/// onboarding flow's empty states.
struct SquadsListView: View {
    @State var viewModel: SquadsListViewModel
    @Environment(AppContainer.self) private var container
    /// Drives the Create sheet from both the empty-state CTA and the
    /// toolbar "+" button.
    @State private var showCreate = false
    /// Navigation push to a squad detail. Set via row tap; consumed by
    /// the `navigationDestination(item:)` modifier below.
    @State private var pushedDetail: SquadDetailRoute?

    /// `Identifiable` wrapper around a squad id so `navigationDestination(item:)`
    /// can re-present the detail when the user navigates between squads
    /// from elsewhere (deep link, etc.). Keeps the destination type
    /// stable across taps.
    fileprivate struct SquadDetailRoute: Identifiable, Hashable {
        let squadId: String
        var id: String { squadId }
    }

    var body: some View {
        ZStack {
            PremiumAuthBackground()
            content
        }
        .navigationTitle(Text("squads.title"))
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    showCreate = true
                } label: {
                    Image(systemName: "plus")
                        .fontWeight(.semibold)
                }
                .accessibilityLabel(Text("squads.create"))
            }
        }
        .task { await viewModel.onAppear() }
        .refreshable { await viewModel.load() }
        .sheet(isPresented: $showCreate) {
            CreateSquadView(
                viewModel: CreateSquadViewModel(apiClient: container.apiClient),
                onCreated: { squad in
                    showCreate = false
                    viewModel.upsert(squad)
                    // Push straight into the new squad so the user can
                    // start inviting partners right away — the canonical
                    // post-create flow for a relationship feature.
                    pushedDetail = SquadDetailRoute(squadId: squad.id)
                }
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .presentationBackground(.ultraThinMaterial)
        }
        .navigationDestination(item: $pushedDetail) { route in
            SquadDetailView(
                viewModel: SquadDetailViewModel(
                    apiClient: container.apiClient,
                    squadId: route.squadId,
                    currentUserId: viewModel.currentUserId
                ),
                onMutated: { mutation in
                    // The detail screen calls this on leave / delete so
                    // we can prune the row locally instead of waiting
                    // for a full list refresh.
                    switch mutation {
                    case .deleted(let id), .left(let id):
                        viewModel.remove(squadId: id)
                    case .updated(let squad):
                        viewModel.upsert(squad)
                    }
                }
            )
        }
    }

    // MARK: - Content states

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            loadingSkeleton
        case .empty:
            emptyState
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.load() } }
        case .loaded(let squads):
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(squads) { squad in
                        Button {
                            UISelectionFeedbackGenerator().selectionChanged()
                            pushedDetail = SquadDetailRoute(squadId: squad.id)
                        } label: {
                            SquadCard(squad: squad, isOwner: squad.owner_user_id == viewModel.currentUserId)
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer().frame(height: 80)
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
            }
            .scrollIndicators(.hidden)
        }
    }

    // MARK: - Empty state

    /// First-impression surface for users who have no squads yet. Mirrors
    /// the "matches.empty" style — accent medallion, heading, supporting
    /// copy, and a generous PrimaryButton — but uses the explicit
    /// AZ-first copy from the spec ("Squad yoxdur. İlk padel qrupunu yarat!").
    private var emptyState: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.16))
                    .frame(width: 96, height: 96)
                Circle()
                    .strokeBorder(DSColor.accent.opacity(0.40), lineWidth: 1)
                    .frame(width: 96, height: 96)
                Image(systemName: "person.3.fill")
                    .font(.system(size: 36, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            VStack(spacing: 6) {
                Text("squads.empty.title")
                    .font(.system(size: 20, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                Text("squads.empty.message")
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .padding(.horizontal, 24)
            }
            PrimaryButton(
                title: String(localized: "squads.create"),
                icon: "plus"
            ) {
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                showCreate = true
            }
            .frame(maxWidth: 280)
            .padding(.top, 4)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var loadingSkeleton: some View {
        ScrollView {
            VStack(spacing: 12) {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(.ultraThinMaterial)
                        .frame(height: 116)
                        .overlay(
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .strokeBorder(DSColor.border.opacity(0.3), lineWidth: 1)
                        )
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
        .scrollIndicators(.hidden)
    }
}

// MARK: - List card

/// Single squad row. Photo medallion on the left, three text lines on
/// the right: name (heavy), member count microline, optional teaser
/// for the squad's next upcoming game. Glass card surface — same
/// vocabulary as `MatchRowCard` so the discover and squads tabs feel
/// like one family.
private struct SquadCard: View {
    let squad: Squad
    let isOwner: Bool

    var body: some View {
        HStack(spacing: 14) {
            photoMedallion
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(squad.name)
                        .font(.system(size: 16, weight: .heavy))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                    if isOwner {
                        ownerPill
                    }
                }
                Text(memberCountText)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DSColor.textSecondary)
                    .monospacedDigit()
                if let teaser = nextGameTeaser {
                    HStack(spacing: 5) {
                        Image(systemName: "calendar.badge.clock")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(DSColor.accent)
                        Text(teaser)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(DSColor.textSecondary)
                            .lineLimit(1)
                    }
                    .padding(.top, 2)
                }
            }
            Spacer(minLength: 6)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(DSColor.textTertiary)
        }
        .padding(14)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1)
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(squad.name))
        .accessibilityHint(Text(memberCountText))
    }

    /// Photo medallion. Falls back to a brand-coloured monogram when the
    /// squad has no picture set (most common case in the empty / fresh
    /// account flow). Uses `CachedAsyncImage` so the network image is
    /// served from the on-device cache after the first hit.
    private var photoMedallion: some View {
        ZStack {
            if let url = squadPhotoURL {
                CachedAsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    monogramFallback
                }
            } else {
                monogramFallback
            }
        }
        .frame(width: 56, height: 56)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.5), lineWidth: 1)
        )
    }

    private var monogramFallback: some View {
        ZStack {
            LinearGradient(
                colors: [DSColor.accent, DSColor.accentSoft],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Text(initials(squad.name))
                .font(.system(size: 18, weight: .heavy))
                .foregroundStyle(DSColor.textOnAccent)
        }
    }

    /// Small "Captain" pill for squads the viewer owns. Sits inline with
    /// the squad name so the role is legible at a glance without taking
    /// a full row.
    private var ownerPill: some View {
        Text("squads.role.owner")
            .font(.system(size: 9, weight: .heavy))
            .foregroundStyle(DSColor.accent)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Capsule().fill(DSColor.accent.opacity(0.16)))
            .overlay(Capsule().strokeBorder(DSColor.accent.opacity(0.4), lineWidth: 1))
    }

    private var squadPhotoURL: URL? {
        guard let raw = squad.photo_url, !raw.isEmpty, !raw.hasPrefix("data:") else { return nil }
        return URL(string: raw)
    }

    private var memberCountText: String {
        String(format: String(localized: "squads.member_count_format"),
               squad.member_count, squad.max_size)
    }

    /// Localized one-liner like "Next: Tomorrow, 19:00 · Padel Klub".
    /// Returns `nil` when the squad has no upcoming game with 2+
    /// participating members (the server omits `next_game` in that case).
    private var nextGameTeaser: String? {
        guard let next = squad.next_game else { return nil }
        let parts = [shortDate(next.starts_at), next.venue_name].compactMap { $0 }.filter { !$0.isEmpty }
        let body = parts.joined(separator: " · ")
        return String(format: String(localized: "squads.next_game_format"), body)
    }

    /// Best-effort short representation of an ISO timestamp. Falls back
    /// to the raw string if parsing fails so the cell never goes blank
    /// on an unexpected wire format.
    private func shortDate(_ iso: String) -> String {
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = isoFormatter.date(from: iso)
        if date == nil {
            isoFormatter.formatOptions = [.withInternetDateTime]
            date = isoFormatter.date(from: iso)
        }
        guard let d = date else { return iso }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: d)
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        return parts.joined().isEmpty ? "?" : parts.joined()
    }
}
