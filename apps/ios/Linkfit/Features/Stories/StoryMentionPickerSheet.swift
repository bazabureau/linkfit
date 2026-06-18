import SwiftUI
import Observation

/// Bottom-sheet that lets the user pick somebody they follow to mention on
/// the current story. Surface design notes:
///
///   • NavigationStack title "Oyunçunu qeyd et" (AZ-first; falls back via the
///     xcstrings table for EN/RU).
///   • Search field anchored at the top — filters the in-memory list against
///     `display_name` (case- and diacritic-insensitive). We do NOT hit a
///     `/search` endpoint here — the typical user follows tens of players,
///     not thousands, and the story editor is a transient surface where a
///     network spinner on every keystroke would feel jarring.
///   • Rows: avatar + display name + skill chip (when ELO is available). A
///     plain tap dismisses the sheet with the picked user.
///   • Empty state: a soft "İzlədiyin oyunçu yoxdur" prompt — distinct from
///     a "no search results" message because the action the user should
///     take is different (go follow somebody vs. broaden their query).
///
/// The view-model is kept inside this file because it's specific to the
/// mention picker and has no other call sites. Keeping it private avoids
/// polluting the codebase with another `*ViewModel` symbol.

// MARK: - Picked user shape

/// Lightweight DTO handed to `onSelect`. We deliberately don't pass a raw
/// `FollowEdge` so the parent (`MentionToolButton`) doesn't need to know
/// the wire-shape of the follow endpoint — the picker is responsible for
/// translating whatever upstream type it ingests (currently `FollowEdge`)
/// into this stable surface.
struct StoryMentionUser: Identifiable, Equatable {
    let id: String
    let display_name: String
    let avatar_url: String?
    /// Server-supplied ELO (optional — many follows are casual players
    /// without recorded games). Drives the skill chip on the row.
    let primary_elo: Int?
}

// MARK: - View

struct StoryMentionPickerSheet: View {
    /// Tapping a row hands the chosen user back to the host. The host owns
    /// dismiss/append-overlay; the sheet itself doesn't reach into the
    /// canvas state.
    let onSelect: (StoryMentionUser) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(AppContainer.self) private var container

    @State private var viewModel = StoryMentionPickerViewModel()
    @State private var query: String = ""

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                content
            }
            .navigationTitle(Text("stories.mention.picker.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(DSColor.textPrimary)
                            .padding(8)
                            .background(Circle().fill(DSColor.surface))
                    }
                    .accessibilityLabel(Text("common.close"))
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(.ultraThinMaterial)
        .task {
            await viewModel.loadIfNeeded(container: container)
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        VStack(spacing: DSSpacing.md) {
            SearchField(
                text: $query,
                placeholderKey: "stories.mention.picker.search",
                autofocus: true
            )
            .padding(.horizontal, DSSpacing.md)
            .padding(.top, DSSpacing.sm)

            switch viewModel.state {
            case .loading:
                ScrollView {
                    SkeletonView(shape: .avatar, count: 6)
                        .padding(.horizontal, DSSpacing.md)
                        .padding(.top, DSSpacing.sm)
                }
                .scrollDisabled(true)
            case .ready(let users):
                let filtered = filter(users, query: query)
                if filtered.isEmpty {
                    emptyState
                } else {
                    list(users: filtered)
                }
            case .error(let message):
                ErrorStateView(message: message) {
                    Task { await viewModel.refresh(container: container) }
                }
            }
        }
    }

    private func list(users: [StoryMentionUser]) -> some View {
        ScrollView {
            LazyVStack(spacing: DSSpacing.sm) {
                ForEach(users) { user in
                    Button {
                        Haptics.selection()
                        onSelect(user)
                    } label: {
                        row(user: user)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.bottom, DSSpacing.lg)
        }
    }

    private func row(user: StoryMentionUser) -> some View {
        HStack(spacing: DSSpacing.sm) {
            avatar(for: user)
            VStack(alignment: .leading, spacing: 2) {
                Text(user.display_name)
                    .font(.system(.subheadline, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                    .lineLimit(1)
                // Skill chip — only renders when we have an ELO. Helps the
                // user disambiguate between same-named players (rare, but
                // shows up in the player directory as well).
                if user.primary_elo != nil {
                    let level = SkillLevel.from(elo: user.primary_elo)
                    HStack(spacing: 4) {
                        Image(systemName: level.systemImage)
                            .font(.system(size: 9, weight: .bold))
                        Text(level.shortKey)
                            .font(DSType.caption2)
                    }
                    .foregroundStyle(level.accent)
                }
            }
            Spacer(minLength: DSSpacing.xs)
        }
        .padding(DSSpacing.md)
        .background(RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous).fill(DSColor.surface))
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(user.display_name))
    }

    private func avatar(for user: StoryMentionUser) -> some View {
        ZStack {
            Circle().fill(LinearGradient(
                colors: [DSColor.accent, DSColor.accentSoft],
                startPoint: .topLeading, endPoint: .bottomTrailing
            ))
            if let urlString = user.avatar_url, let url = URL(string: urlString) {
                CachedAsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Text(initials(user.display_name))
                        .font(.system(.footnote, design: .default, weight: .bold))
                        .foregroundStyle(DSColor.textOnAccent)
                }
                .clipShape(Circle())
            } else {
                Text(initials(user.display_name))
                    .font(.system(.footnote, design: .default, weight: .bold))
                    .foregroundStyle(DSColor.textOnAccent)
            }
        }
        .frame(width: 44, height: 44)
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        return parts.joined().isEmpty ? "?" : parts.joined()
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: DSSpacing.md) {
            Spacer()
            Image(systemName: "person.crop.circle.badge.questionmark")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(DSColor.textTertiary)
            Text("stories.mention.empty")
                .font(.system(.subheadline, design: .default, weight: .semibold))
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, DSSpacing.lg)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Filter helper

    /// Diacritic- + case-insensitive substring match. SwiftUI's default
    /// `.localizedCaseInsensitiveContains` doesn't strip diacritics, which
    /// matters for AZ names where the user might type "alibe" expecting to
    /// find "Əlibəy". Falls back to the raw match when normalization fails
    /// for any locale-specific reason.
    private func filter(_ users: [StoryMentionUser], query: String) -> [StoryMentionUser] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return users }
        let needle = trimmed.folding(options: [.diacriticInsensitive, .caseInsensitive],
                                     locale: .current)
        return users.filter { user in
            let hay = user.display_name.folding(options: [.diacriticInsensitive, .caseInsensitive],
                                                locale: .current)
            return hay.contains(needle)
        }
    }
}

// MARK: - View-model

/// In-process state for the picker.
///
/// Load policy:
///   • First fetch the viewer's `following` edges (`GET /api/v1/users/me/following`)
///     via the existing `FollowsPage` endpoint. The wire shape only carries
///     id / display name / avatar — we surface those without an ELO.
///   • The picker doesn't paginate visually (the search field is the
///     navigation primitive). To keep the UX honest we pull a reasonably
///     large window (200) which covers the long tail of casual users.
@Observable
@MainActor
private final class StoryMentionPickerViewModel {
    enum State {
        case loading
        case ready([StoryMentionUser])
        case error(String)
    }

    private(set) var state: State = .loading
    private var loaded: Bool = false

    /// Idempotent loader. Reads `container.currentUser?.id` to scope the
    /// `following` query — if the viewer is signed out we degrade to an
    /// empty list rather than crashing (the editor shouldn't be reachable
    /// while signed out, but defending against the impossible costs us
    /// nothing).
    func loadIfNeeded(container: AppContainer) async {
        guard !loaded else { return }
        await refresh(container: container)
    }

    func refresh(container: AppContainer) async {
        guard let viewerId = container.currentUser?.id else {
            state = .ready([])
            loaded = true
            return
        }
        state = .loading
        do {
            let page = try await container.apiClient.send(
                Endpoint<FollowsPage>.following(userId: viewerId, limit: 200, offset: 0)
            )
            let users = page.items.map {
                StoryMentionUser(
                    id: $0.id,
                    display_name: $0.display_name,
                    avatar_url: $0.photo_url,
                    primary_elo: nil
                )
            }
            state = .ready(users)
            loaded = true
        } catch let error as APIError {
            state = .error(error.localizedMessage)
        } catch {
            state = .error(error.localizedDescription)
        }
    }
}
