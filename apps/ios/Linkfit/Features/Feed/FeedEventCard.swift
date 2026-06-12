import SwiftUI

/// Where tapping a feed card should take the caller. The host (typically the
/// shell) maps these to its own NavigationStack destinations — see
/// `FeedHook.swift` for the recommended wiring.
enum FeedCardTarget: Equatable {
    case game(String)
    case tournament(String)
    case profile(String)
    /// Event has no useful detail target (e.g. an ELO milestone). The card
    /// will be tap-disabled — we still show it, just without affordance.
    case none
}

/// A single row in `FeedView`. Renders an actor avatar, a localized one-line
/// summary, and a relative timestamp. Tapping the summary invokes
/// `onTap`; tapping the comments row below the summary invokes
/// `onTapComments` so the host can present `FeedCommentsSheet`.
///
/// Comments are presented via `onTapComments` rather than baked into
/// this card directly because the sheet needs viewer-identity context
/// (current user id + display name + avatar URL for optimistic inserts)
/// and the host owns that wiring — same convention `onTap` follows for
/// navigation routing.
struct FeedEventCard: View {
    let event: FeedEvent
    let onTap: (FeedCardTarget) -> Void
    /// Optional handler for the "N şərh" affordance below the summary.
    /// When non-nil the comments row renders; the host typically opens
    /// `FeedCommentsSheet` here. Optional so legacy call sites that
    /// don't yet wire comments compile unchanged.
    var onTapComments: (() -> Void)? = nil
    /// Authoritative comment count for the badge. `nil` renders the
    /// localized "Şərhlər" label without a number (used until the host
    /// has fetched one). The label is left-aligned so the chevron
    /// stays anchored regardless of digit width.
    var commentCount: Int? = nil

    /// Shared formatters — `relativeCreatedAt` runs every body pass per
    /// card and the feed scrolls long. The server emits either ISO with
    /// fractional seconds or without, so we keep two pre-configured
    /// parsers and fall back from the fractional one to the plain one.
    private static let isoFractionalFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f
    }()

    private var target: FeedCardTarget {
        switch event.type {
        case .joined_game, .won_match:
            if let id = event.payload["game_id"]?.stringValue { return .game(id) }
            return .none
        case .registered_tournament:
            if let id = event.payload["tournament_id"]?.stringValue { return .tournament(id) }
            return .none
        case .followed_user:
            if let id = event.payload["followed_user_id"]?.stringValue { return .profile(id) }
            return .none
        case .elo_milestone, .new_partnership:
            return .profile(event.actor.id)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            summaryButton
            if onTapComments != nil {
                Divider()
                    .overlay(DSColor.border)
                    .padding(.horizontal, DSSpacing.md)
                commentsButton
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous).fill(DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
    }

    /// The original summary card — wrapped in its own button so the
    /// comments affordance below has a distinct hit target. Disabled when
    /// the event has no useful navigation destination; the comments row
    /// stays usable either way.
    private var summaryButton: some View {
        Button {
            onTap(target)
        } label: {
            HStack(alignment: .top, spacing: DSSpacing.sm) {
                avatar
                VStack(alignment: .leading, spacing: 6) {
                    summaryLine
                    Text(relativeCreatedAt)
                        .font(.system(.caption2, design: .default))
                        .foregroundStyle(DSColor.textTertiary)
                }
                Spacer(minLength: DSSpacing.xs)
                if target != .none {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(DSColor.textTertiary)
                }
            }
            .padding(DSSpacing.md)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(target == .none)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(accessibilityLabel))
    }

    /// `[bubble icon] N şərh` affordance with a trailing chevron. Tapping
    /// invokes `onTapComments` so the host can present the comments sheet.
    /// Always tappable when `onTapComments` is wired — comments are
    /// available on every event type, even ones with no navigable target.
    private var commentsButton: some View {
        Button {
            onTapComments?()
        } label: {
            HStack(spacing: DSSpacing.xs) {
                Image(systemName: "bubble.left")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DSColor.textSecondary)
                Text(commentsLabel)
                    .font(.system(.footnote, design: .default, weight: .medium))
                    .foregroundStyle(DSColor.textSecondary)
                Spacer(minLength: DSSpacing.xs)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DSColor.textTertiary)
            }
            .padding(.horizontal, DSSpacing.md)
            .padding(.vertical, DSSpacing.sm)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(commentsAccessibilityLabel))
    }

    /// Localized "{N} şərh" / "Şərhlər" label. We use the integer-aware
    /// "feed.comments.count.label" format so translators can apply the
    /// language's pluralization rules — falls through to a plain
    /// "Şərhlər" label when we don't yet know the count.
    private var commentsLabel: String {
        guard let n = commentCount else {
            return String(localized: "feed.comments.label")
        }
        let format = String(localized: "feed.comments.count.label")
        return String(format: format, n)
    }

    private var commentsAccessibilityLabel: String {
        if let n = commentCount {
            let format = String(localized: "feed.comments.count.a11y")
            return String(format: format, n)
        }
        return String(localized: "feed.comments.label")
    }

    // MARK: - Subviews

    private var avatar: some View {
        ZStack {
            Circle().fill(LinearGradient(
                colors: [DSColor.accent, DSColor.accentSoft],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )).frame(width: 44, height: 44)
            Text(initials(event.actor.display_name))
                .font(.system(.footnote, design: .default, weight: .bold))
                .foregroundStyle(DSColor.textOnAccent)
        }
    }

    /// Localized one-line summary. We render the actor name in `.semibold`
    /// + the rest of the summary in regular weight via `AttributedString`
    /// so the actor stays visually prominent.
    private var summaryLine: some View {
        let name = event.actor.display_name
        let rest = templateBody
        var attributed = AttributedString(name + " ")
        attributed.font = .system(.subheadline, design: .default, weight: .semibold)
        attributed.foregroundColor = DSColor.textPrimary
        var restAttr = AttributedString(rest)
        restAttr.font = .system(.subheadline, design: .default)
        restAttr.foregroundColor = DSColor.textPrimary
        attributed.append(restAttr)
        return Text(attributed).lineLimit(3).fixedSize(horizontal: false, vertical: true)
    }

    /// Plain-string template — used both by the summary and the
    /// accessibility label. The strings live in `Localizable.xcstrings` so
    /// translators control wording.
    private var templateBody: String {
        let langCode = UserDefaults.standard.string(forKey: "linkfit.language") ?? "az"
        let locale = Locale(identifier: langCode)
        switch event.type {
        case .joined_game:
            if let venue = event.payload["venue_name"]?.stringValue, !venue.isEmpty {
                let tmpl = String(localized: "feed.event.joined_game.with_venue", locale: locale)
                return String(format: tmpl, venue)
            }
            return String(localized: "feed.event.joined_game", locale: locale)
        case .won_match:
            return String(localized: "feed.event.won_match", locale: locale)
        case .registered_tournament:
            if let name = event.payload["tournament_name"]?.stringValue, !name.isEmpty {
                let tmpl = String(localized: "feed.event.registered_tournament.named", locale: locale)
                return String(format: tmpl, name)
            }
            return String(localized: "feed.event.registered_tournament", locale: locale)
        case .elo_milestone:
            // Display the new skill bucket the player reached rather
            // than the raw ELO number. Matches the app-wide convention
            // of hiding the ELO integer behind a word label.
            if let elo = event.payload["elo_rating"]?.intValue {
                let level = SkillLevel.from(elo: elo).localizedName
                let tmpl = String(localized: "feed.event.elo_milestone.value", locale: locale)
                // The template still has a `%@` slot — passing the level
                // word reads as "Reached Advanced" / "Səviyyəyə çatdı:
                // Təcrübəli". Old payloads that templated an int will
                // simply render the int as %@; we accept that drift.
                return String(format: tmpl, level as CVarArg)
            }
            return String(localized: "feed.event.elo_milestone", locale: locale)
        case .followed_user:
            return String(localized: "feed.event.followed_user", locale: locale)
        case .new_partnership:
            return String(localized: "feed.event.new_partnership", locale: locale)
        }
    }

    private var accessibilityLabel: String {
        "\(event.actor.display_name) \(templateBody), \(relativeCreatedAt)"
    }

    private var relativeCreatedAt: String {
        let date = Self.isoFractionalFormatter.date(from: event.created_at)
            ?? Self.isoFormatter.date(from: event.created_at)
        guard let d = date else { return event.created_at }
        
        let langCode = UserDefaults.standard.string(forKey: "linkfit.language") ?? "az"
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        formatter.locale = Locale(identifier: langCode)
        return formatter.localizedString(for: d, relativeTo: Date())
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        return parts.joined().isEmpty ? "?" : parts.joined()
    }
}
