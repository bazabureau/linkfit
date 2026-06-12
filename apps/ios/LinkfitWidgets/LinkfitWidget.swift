//
//  LinkfitWidget.swift
//  LinkfitWidgets
//
//  The Today / Home-screen / Lock-screen widget for Linkfit. Reads pre-cached
//  data from the App Group via `WidgetCache` — never touches the network.
//
//  Design language: lime-on-dark, matching the brand palette. The widget owns
//  its own colors (it can't import the app's design system without dragging
//  in the entire DesignSystem module), so we hard-code the two tokens we need.
//
//  Families:
//    • .systemSmall          — next-game time + venue
//    • .systemMedium         — next-game time + venue + current streak
//    • .accessoryRectangular — lock-screen one-liner (next game, sport-coded)
//
//  Timeline:
//    Refreshes every 30 minutes. The provider doesn't compute "next" itself —
//    it just snapshots whatever the app last wrote. If the app's cache says
//    the next game is in the past (rare race), we hide it.
//
//  Deep link:
//    Tapping the widget routes to `linkfit://g/<id>` via `widgetURL(_:)`. The
//    main app's RootView is expected to handle that scheme via `.onOpenURL`.

import WidgetKit
import SwiftUI

// MARK: - Brand palette (widget-local)

private enum WidgetPalette {
    /// Deep canvas matching `DSColor.background` (dark variant). Hard-coded
    /// because widgets render in a separate process and cannot share the
    /// app's resolved Color tokens.
    static let canvas = Color(red: 0x0A / 255.0, green: 0x0E / 255.0, blue: 0x14 / 255.0)
    /// Brand lime accent.
    static let lime = Color(red: 0xC8 / 255.0, green: 0xFF / 255.0, blue: 0x3D / 255.0)
    static let limeDim = Color(red: 0x9F / 255.0, green: 0xCB / 255.0, blue: 0x2C / 255.0)
    static let ink = Color.white
    static let inkMuted = Color.white.opacity(0.65)
}

// MARK: - Entry

struct LinkfitEntry: TimelineEntry {
    let date: Date
    let game: WidgetGame?
    let streak: Int
    let unread: Int

    static let placeholder = LinkfitEntry(
        date: Date(),
        game: WidgetGame(
            id: "preview",
            sport: "Tennis",
            startsAt: Date().addingTimeInterval(60 * 60 * 3),
            venueName: "Baku Tennis Center"
        ),
        streak: 4,
        unread: 0
    )

    static let empty = LinkfitEntry(date: Date(), game: nil, streak: 0, unread: 0)
}

// MARK: - Provider

struct LinkfitProvider: TimelineProvider {

    func placeholder(in context: Context) -> LinkfitEntry {
        .placeholder
    }

    func getSnapshot(in context: Context, completion: @escaping (LinkfitEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LinkfitEntry>) -> Void) {
        let entry = currentEntry()
        // Refresh every 30 minutes. WidgetKit will coalesce this with system
        // budget — treat it as a hint, not a guarantee.
        let nextRefresh = Date().addingTimeInterval(30 * 60)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }

    private func currentEntry() -> LinkfitEntry {
        let cache = WidgetCache.shared
        let game = cache.nextGame.flatMap { game -> WidgetGame? in
            // Drop stale games — if the app missed a refresh window, don't
            // keep showing yesterday's match on the lock screen.
            game.startsAt > Date().addingTimeInterval(-60 * 30) ? game : nil
        }
        return LinkfitEntry(
            date: Date(),
            game: game,
            streak: cache.currentStreak,
            unread: cache.unreadConversations
        )
    }
}

// MARK: - Deep link

private func deepLink(for game: WidgetGame?) -> URL {
    if let id = game?.id {
        return URL(string: "linkfit://g/\(id)") ?? URL(string: "linkfit://home")!
    }
    return URL(string: "linkfit://matchmaking")!
}

// MARK: - Views

struct LinkfitWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: LinkfitEntry

    var body: some View {
        Group {
            switch family {
            case .systemSmall:           SmallView(entry: entry)
            case .systemMedium:          MediumView(entry: entry)
            case .accessoryRectangular:  LockView(entry: entry)
            default:                     SmallView(entry: entry)
            }
        }
        .widgetURL(deepLink(for: entry.game))
        .containerBackground(for: .widget) {
            // Lock-screen accessories ignore the container background; the
            // system uses its own vibrancy material. For home-screen sizes,
            // paint our deep canvas.
            WidgetPalette.canvas
        }
    }
}

// MARK: Small (next game only)

private struct SmallView: View {
    let entry: LinkfitEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            header
            Spacer(minLength: 0)
            if let game = entry.game {
                Text(game.startsAt, style: .time)
                    .font(.system(size: 26, weight: .heavy, design: .rounded))
                    .foregroundStyle(WidgetPalette.lime)
                Text(game.sport.uppercased())
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(WidgetPalette.limeDim)
                    .tracking(0.8)
                Text(game.venueName)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(WidgetPalette.inkMuted)
                    .lineLimit(2)
            } else {
                EmptyStateLabel()
            }
        }
        .padding(.vertical, 2)
    }

    private var header: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(WidgetPalette.lime)
                .frame(width: 6, height: 6)
            Text(entry.game == nil ? "LINKFIT" : "NEXT UP")
                .font(.system(size: 10, weight: .heavy))
                .tracking(1.2)
                .foregroundStyle(WidgetPalette.inkMuted)
        }
    }
}

// MARK: Medium (next game + streak)

private struct MediumView: View {
    let entry: LinkfitEntry

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Circle().fill(WidgetPalette.lime).frame(width: 6, height: 6)
                    Text("NEXT UP")
                        .font(.system(size: 10, weight: .heavy))
                        .tracking(1.2)
                        .foregroundStyle(WidgetPalette.inkMuted)
                }
                if let game = entry.game {
                    Text(game.startsAt, style: .time)
                        .font(.system(size: 28, weight: .heavy, design: .rounded))
                        .foregroundStyle(WidgetPalette.lime)
                    Text(game.sport)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(WidgetPalette.ink)
                    Text(game.venueName)
                        .font(.system(size: 12))
                        .foregroundStyle(WidgetPalette.inkMuted)
                        .lineLimit(2)
                } else {
                    EmptyStateLabel()
                }
            }
            Spacer(minLength: 0)
            StreakBadge(streak: entry.streak)
        }
    }
}

private struct StreakBadge: View {
    let streak: Int

    var body: some View {
        VStack(spacing: 2) {
            Text("STREAK")
                .font(.system(size: 9, weight: .heavy))
                .tracking(1.0)
                .foregroundStyle(WidgetPalette.canvas.opacity(0.7))
            Text("\(streak)")
                .font(.system(size: 30, weight: .black, design: .rounded))
                .foregroundStyle(WidgetPalette.canvas)
            Text(streak == 1 ? "week" : "weeks")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(WidgetPalette.canvas.opacity(0.7))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(WidgetPalette.lime)
        )
    }
}

// MARK: Lock-screen accessoryRectangular

private struct LockView: View {
    let entry: LinkfitEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let game = entry.game {
                HStack(spacing: 4) {
                    Image(systemName: "figure.tennis")
                        .font(.system(size: 11, weight: .bold))
                    Text(game.sport)
                        .font(.system(size: 12, weight: .heavy))
                }
                Text(game.startsAt, style: .time)
                    .font(.system(size: 16, weight: .heavy, design: .rounded))
                Text(game.venueName)
                    .font(.system(size: 11))
                    .lineLimit(1)
            } else {
                Text("LINKFIT")
                    .font(.system(size: 11, weight: .heavy))
                Text("No games scheduled")
                    .font(.system(size: 12, weight: .semibold))
                Text("Tap to find a match")
                    .font(.system(size: 11))
            }
        }
        .widgetAccentable()
    }
}

// MARK: Empty state

private struct EmptyStateLabel: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("No games scheduled")
                .font(.system(size: 14, weight: .heavy))
                .foregroundStyle(WidgetPalette.ink)
            Text("Tap to find a match")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(WidgetPalette.lime)
        }
    }
}

// MARK: - Widget entry

struct LinkfitWidget: Widget {
    /// Stable identifier — keep in sync with `WidgetCache.widgetKind` so the
    /// app can reload us by name without importing this module.
    static let kind = "az.linkfit.next-game"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: LinkfitProvider()) { entry in
            LinkfitWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Linkfit — Next Game")
        .description("Your next match, current streak, and quick access to matchmaking.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
        .contentMarginsDisabled()
    }
}

// MARK: - Bundle

@main
struct LinkfitWidgetsBundle: WidgetBundle {
    var body: some Widget {
        LinkfitWidget()
        NextMatchWidget()
    }
}

// MARK: - Previews

#Preview(as: .systemSmall) {
    LinkfitWidget()
} timeline: {
    LinkfitEntry.placeholder
    LinkfitEntry.empty
}

#Preview(as: .systemMedium) {
    LinkfitWidget()
} timeline: {
    LinkfitEntry.placeholder
}

#Preview(as: .accessoryRectangular) {
    LinkfitWidget()
} timeline: {
    LinkfitEntry.placeholder
    LinkfitEntry.empty
}
