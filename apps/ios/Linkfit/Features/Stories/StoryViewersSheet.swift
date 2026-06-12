import SwiftUI

/// Instagram-style "who viewed your story" sheet. Owner-only — the
/// host (`StoryViewer`) only presents this when the active story
/// belongs to the viewer themselves (`ownsCurrent`), and the
/// underlying `GET /api/v1/stories/:id/viewers` endpoint is gated
/// server-side as well (403 for non-owners).
///
/// Layout:
///   * NavigationStack with the localized "Baxanlar" title.
///   * Trailing toolbar close button (matches `FollowListView` /
///     `ProfileFollowsSheetWithRoute` chrome).
///   * State-aware body — skeleton on `.loading`, empty medallion +
///     copy on `.empty`, retry CTA on `.error`, scrollable list of
///     viewer rows on `.loaded`.
///   * Pull-to-refresh on the list so a newly-arrived viewer or
///     reaction shows up without re-opening the sheet.
///
/// Row anatomy (matches Instagram's "Activity → Story views"):
///   * 32pt avatar circle (CachedAsyncImage with initials fallback)
///   * Display name (semibold)
///   * Relative "5 dəq əvvəl" subtitle under the name
///   * Optional reaction emoji chip on the trailing side when the
///     viewer also reacted on the story (`reaction_emoji != nil`)
///   * Tap → fires `onPickUser` so the host can present a stacked
///     ProfileView sheet (matches the FollowsList pattern).
///
/// Why a separate file from `StoryViewer.swift`: the sheet has its own
/// lifecycle, navigation, and pause-the-timer contract — folding it
/// into the already-large viewer file would force every reader to
/// scroll past 100 lines of unrelated chrome. The host owns the
/// sheet-presented state and pauses the underlying story timer for
/// the duration of presentation.
struct StoryViewersSheet: View {
    @State var viewModel: StoryViewersViewModel
    /// Invoked when a row is tapped. The host owns the navigation
    /// surface (the viewer is full-screen, so we can't push directly
    /// — instead the host dismisses the sheet and presents a stacked
    /// ProfileView sheet, same pattern as `ProfileFollowsSheetWith-
    /// Route`).
    let onPickUser: (String) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                content
            }
            .navigationTitle(Text("stories.viewers.title"))
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
        .task { await viewModel.onAppear() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            // Optimistic empty render — skeleton row count matches a
            // typical first-page response so the layout doesn't pop
            // when the real data lands. `.scrollDisabled` because the
            // skeleton is purely decorative.
            ScrollView {
                SkeletonView(shape: .row, count: 8)
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.top, DSSpacing.md)
            }
            .scrollDisabled(true)
        case .empty:
            emptyState
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.refresh() } }
        case .loaded(let viewers):
            ScrollView {
                LazyVStack(spacing: DSSpacing.sm) {
                    ForEach(viewers) { viewer in
                        row(viewer)
                    }
                    Spacer().frame(height: 60)
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.top, DSSpacing.md)
            }
            .refreshable { await viewModel.refresh() }
        }
    }

    // MARK: - Empty state

    /// Same glass-card + medallion treatment used by FollowListView /
    /// PlayersView empty states. Copy reads as informational ("Story
    /// 24 saatdan sonra silinəcək") rather than apologetic — there's
    /// no fix-it CTA because the only "fix" is to wait for viewers.
    private var emptyState: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.16))
                    .frame(width: 72, height: 72)
                Circle()
                    .strokeBorder(DSColor.accent.opacity(0.40), lineWidth: 1)
                    .frame(width: 72, height: 72)
                Image(systemName: "eye")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            VStack(spacing: 4) {
                Text("stories.viewers.empty.title")
                    .font(.system(size: 17, weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                Text("stories.viewers.empty.body")
                    .font(.system(size: 14, weight: .regular, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .padding(.horizontal, 8)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1)
        )
        .padding(.horizontal, DSSpacing.md)
        .padding(.top, 60)
    }

    // MARK: - Row

    /// One viewer entry — avatar + name + relative viewed_at + optional
    /// reaction chip. Tap fires `onPickUser` so the host can route to
    /// the viewer's profile.
    private func row(_ viewer: StoryViewerInfo) -> some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            onPickUser(viewer.user_id)
        } label: {
            HStack(spacing: DSSpacing.sm) {
                avatar(for: viewer)
                VStack(alignment: .leading, spacing: 2) {
                    Text(viewer.display_name)
                        .font(.system(.subheadline, design: .rounded, weight: .semibold))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                    Text(relativeViewedAt(viewer.viewed_at))
                        .font(.system(.caption2, design: .rounded))
                        .foregroundStyle(DSColor.textTertiary)
                }
                Spacer(minLength: DSSpacing.xs)
                // Reaction chip — only when the viewer also reacted on
                // this story. The chip mirrors the glyph the reactor
                // saw in `StoryReactionsBar` so the owner gets an at-a-
                // glance "they ❤️'d it" signal without opening a
                // sub-screen. Unknown wire keys (forward-compat) just
                // render nothing.
                if let emoji = viewer.reaction_emoji,
                   let glyph = reactionGlyph(for: emoji) {
                    Text(glyph)
                        .font(.system(size: 14))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(
                            Capsule().fill(DSColor.surface.opacity(0.6))
                        )
                        .overlay(
                            Capsule()
                                .strokeBorder(DSColor.border.opacity(0.5), lineWidth: 1)
                        )
                        .accessibilityHidden(true)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DSColor.textTertiary)
            }
            .padding(DSSpacing.md)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.surface))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(viewer.display_name))
    }

    // MARK: - Avatar

    /// 32pt avatar circle. Falls back to a gradient initials disc when
    /// the URL is missing or the cached image hasn't loaded yet —
    /// matches the `FollowListView` row's avatar treatment but at the
    /// smaller "list-row" size the spec calls for.
    private func avatar(for viewer: StoryViewerInfo) -> some View {
        let url: URL? = {
            guard let raw = viewer.avatar_url, !raw.isEmpty,
                  !raw.hasPrefix("data:") else { return nil }
            return URL(string: raw)
        }()
        return ZStack {
            if let url {
                CachedAsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initialsCircle(for: viewer.display_name)
                }
            } else {
                initialsCircle(for: viewer.display_name)
            }
        }
        .frame(width: 32, height: 32)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1))
    }

    private func initialsCircle(for name: String) -> some View {
        ZStack {
            Circle().fill(
                LinearGradient(
                    colors: [DSColor.accent, DSColor.accentSoft],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
            )
            Text(initials(name))
                .font(.system(.caption, design: .rounded, weight: .bold))
                .foregroundStyle(.white)
        }
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        let joined = parts.joined()
        return joined.isEmpty ? "?" : joined
    }

    // MARK: - Reaction glyph

    /// Map a wire reaction key (`"heart"`, `"fire"`, …) to its Unicode
    /// glyph. Returns `nil` for unknown values so a forward-compat
    /// rolling deploy that adds a new reaction never leaks a raw key
    /// like `"laugh"` into the UI — the chip just doesn't render in
    /// that case (the row still does).
    private func reactionGlyph(for wireKey: String) -> String? {
        StoryReactionEmoji(rawValue: wireKey)?.glyph
    }

    // MARK: - Relative time

    /// Format `viewed_at` ISO8601 as "5 dəq əvvəl" / "2 saat əvvəl" /
    /// "indi". Uses `RelativeDateTimeFormatter` so the AZ translation
    /// of "5 minutes ago" lands correctly without a per-unit lookup.
    /// Falls back to the localized "indi" key when the timestamp
    /// can't be parsed (best-effort UX — we'd rather show "indi" than
    /// a raw ISO string in a stranger's view list).
    private func relativeViewedAt(_ iso: String) -> String {
        guard let date = parseISO(iso) else {
            return String(localized: "stories.viewers.relative_now")
        }
        // Under a minute ago — return localized "indi" rather than
        // RelativeDateTimeFormatter's "in 0 seconds" / "now" which
        // doesn't translate cleanly into Azerbaijani.
        let delta = abs(Date().timeIntervalSince(date))
        if delta < 60 {
            return String(localized: "stories.viewers.relative_now")
        }
        return Self.relativeFormatter.localizedString(for: date, relativeTo: Date())
    }

    private func parseISO(_ s: String) -> Date? {
        let withFrac = ISO8601DateFormatter()
        withFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFrac.date(from: s) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: s)
    }

    /// Hoisted off `body` so re-renders during pull-to-refresh don't
    /// allocate a fresh `RelativeDateTimeFormatter` per row per draw.
    /// `.short` style ("5 dəq əvvəl") matches Instagram's terse list
    /// row treatment.
    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f
    }()
}
