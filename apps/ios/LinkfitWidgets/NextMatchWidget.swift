//
//  NextMatchWidget.swift
//  LinkfitWidgets
//
//  Second WidgetKit configuration alongside `LinkfitWidget`. Where the legacy
//  widget surfaces a generic "next game + streak" overview, this one is laser-
//  focused on the user's *closest upcoming match*: opponent name, when it
//  starts (relative), and the court / venue it's at. Designed for users who
//  already have a confirmed match and want it pinned on the home or lock
//  screen as a one-glance reminder.
//
//  Data flow:
//    Main app writes `WidgetMatchSnapshot` to the App Group via
//    `SharedContainer.saveSnapshot(...)`. The provider here only reads —
//    never network, never database. If the snapshot is missing or the match
//    has already started long ago, we render an empty state.
//
//  Timeline:
//    A single entry, refreshed in one of two cadences:
//      • Default — `now + 1 hour`, so a relative-time string ("in 3 hours")
//        doesn't stay stale through a whole afternoon.
//      • Boundary — if the match starts inside the next hour, we refresh at
//        the match start time itself, so "in 5 minutes" becomes "now / in
//        progress" at the right moment. After kick-off we revert to the
//        default 1-hour cadence until the snapshot is replaced or cleared.
//
//  Deep link:
//    Tapping the widget routes to `linkfit://g/<id>` — same convention as
//    `LinkfitWidget`. Empty state routes to `linkfit://matchmaking`.

import WidgetKit
import SwiftUI

// MARK: - Palette (extension-local — see LinkfitWidget for rationale)

private enum NextMatchPalette {
    static let canvas = Color(red: 0x0A / 255.0, green: 0x0E / 255.0, blue: 0x14 / 255.0)
    static let lime = Color(red: 0xC8 / 255.0, green: 0xFF / 255.0, blue: 0x3D / 255.0)
    static let limeDim = Color(red: 0x9F / 255.0, green: 0xCB / 255.0, blue: 0x2C / 255.0)
    static let ink = Color.white
    static let inkMuted = Color.white.opacity(0.62)
}

// MARK: - Entry

struct NextMatchEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetMatchSnapshot?

    static let placeholder = NextMatchEntry(
        date: Date(),
        snapshot: WidgetMatchSnapshot(
            game_id: "preview",
            starts_at: Date().addingTimeInterval(60 * 60 * 3),
            venue_name: "Padel Premier Court",
            opponent_name: "Aysel Mammadova"
        )
    )

    static let empty = NextMatchEntry(date: Date(), snapshot: nil)
}

// MARK: - Provider

struct NextMatchProvider: TimelineProvider {

    func placeholder(in context: Context) -> NextMatchEntry {
        .placeholder
    }

    func getSnapshot(in context: Context, completion: @escaping (NextMatchEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NextMatchEntry>) -> Void) {
        let entry = currentEntry()
        let now = Date()

        // Default cadence: refresh hourly so relative-time copy stays honest.
        let oneHourOut = now.addingTimeInterval(60 * 60)

        // Boundary cadence: if a match starts inside the next hour, reload
        // exactly at the start instant so the widget can flip its label from
        // "in 5 minutes" to "now". Clamp to oneHourOut for safety and never
        // schedule a refresh in the past.
        let nextRefresh: Date
        if let starts = entry.snapshot?.starts_at,
           starts > now,
           starts < oneHourOut {
            nextRefresh = starts
        } else {
            nextRefresh = oneHourOut
        }

        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }

    private func currentEntry() -> NextMatchEntry {
        // Drop matches that started > 30min ago — the user has either shown
        // up or no-showed; either way, the widget shouldn't keep nagging.
        let snapshot = SharedContainer.loadSnapshot().flatMap { snap -> WidgetMatchSnapshot? in
            snap.starts_at > Date().addingTimeInterval(-60 * 30) ? snap : nil
        }
        return NextMatchEntry(date: Date(), snapshot: snapshot)
    }
}

// MARK: - Helpers

/// Renders a humanized "in X" / "in progress" label without depending on the
/// system's `.relative` style (which is fine for SwiftUI labels but doesn't
/// compose well with our own typography). Keeping it in plain text means we
/// own the wording precisely.
private func relativeLabel(for date: Date, now: Date = Date()) -> String {
    let delta = Int(date.timeIntervalSince(now))
    if delta <= 60 { return "now" }
    let minutes = delta / 60
    if minutes < 60 {
        return "in \(minutes) min"
    }
    let hours = minutes / 60
    if hours < 24 {
        return hours == 1 ? "in 1 hour" : "in \(hours) hours"
    }
    let days = hours / 24
    return days == 1 ? "tomorrow" : "in \(days) days"
}

private func deepLink(for snapshot: WidgetMatchSnapshot?) -> URL {
    if let id = snapshot?.game_id {
        return URL(string: "linkfit://g/\(id)") ?? URL(string: "linkfit://home")!
    }
    return URL(string: "linkfit://matchmaking")!
}

// MARK: - Views

struct NextMatchEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: NextMatchEntry

    var body: some View {
        Group {
            switch family {
            case .systemMedium: MediumView(entry: entry)
            default:            SmallView(entry: entry)
            }
        }
        .widgetURL(deepLink(for: entry.snapshot))
        .containerBackground(for: .widget) { NextMatchPalette.canvas }
    }
}

// MARK: Small

private struct SmallView: View {
    let entry: NextMatchEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HeaderLabel(text: entry.snapshot == nil ? "LINKFIT" : "NEXT MATCH")
            Spacer(minLength: 0)
            if let snap = entry.snapshot {
                Text(relativeLabel(for: snap.starts_at))
                    .font(.system(size: 22, weight: .heavy, design: .rounded))
                    .foregroundStyle(NextMatchPalette.lime)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                Text(snap.venue_name)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(NextMatchPalette.inkMuted)
                    .lineLimit(2)
            } else {
                EmptyStateLabel()
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: Medium

private struct MediumView: View {
    let entry: NextMatchEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HeaderLabel(text: entry.snapshot == nil ? "LINKFIT" : "NEXT MATCH")
            if let snap = entry.snapshot {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(relativeLabel(for: snap.starts_at))
                        .font(.system(size: 26, weight: .heavy, design: .rounded))
                        .foregroundStyle(NextMatchPalette.lime)
                    Text("·")
                        .font(.system(size: 18, weight: .heavy))
                        .foregroundStyle(NextMatchPalette.limeDim)
                    Text(snap.starts_at, style: .time)
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .foregroundStyle(NextMatchPalette.ink)
                }
                .minimumScaleFactor(0.7)
                .lineLimit(1)

                VStack(alignment: .leading, spacing: 2) {
                    Label {
                        Text(snap.opponent_name)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(NextMatchPalette.ink)
                            .lineLimit(1)
                    } icon: {
                        Image(systemName: "person.fill")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(NextMatchPalette.limeDim)
                    }
                    Label {
                        Text(snap.venue_name)
                            .font(.system(size: 12))
                            .foregroundStyle(NextMatchPalette.inkMuted)
                            .lineLimit(2)
                    } icon: {
                        Image(systemName: "mappin.and.ellipse")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(NextMatchPalette.limeDim)
                    }
                }
                Spacer(minLength: 0)
            } else {
                EmptyStateLabel()
                Spacer(minLength: 0)
            }
        }
    }
}

// MARK: Shared subviews

private struct HeaderLabel: View {
    let text: String

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(NextMatchPalette.lime).frame(width: 6, height: 6)
            Text(text)
                .font(.system(size: 10, weight: .heavy))
                .tracking(1.2)
                .foregroundStyle(NextMatchPalette.inkMuted)
        }
    }
}

private struct EmptyStateLabel: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("No upcoming match")
                .font(.system(size: 14, weight: .heavy))
                .foregroundStyle(NextMatchPalette.ink)
            Text("Tap to find a game")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(NextMatchPalette.lime)
        }
    }
}

// MARK: - Widget

struct NextMatchWidget: Widget {
    /// Stable identifier — must match `SharedContainer.nextMatchWidgetKind`
    /// so the host app can reload us without importing this file.
    static let kind = "az.linkfit.next-match"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: NextMatchProvider()) { entry in
            NextMatchEntryView(entry: entry)
        }
        .configurationDisplayName("Linkfit — Next Match")
        .description("Your nearest upcoming match: opponent, time, and court.")
        .supportedFamilies([.systemSmall, .systemMedium])
        .contentMarginsDisabled()
    }
}

// MARK: - Previews

#Preview(as: .systemSmall) {
    NextMatchWidget()
} timeline: {
    NextMatchEntry.placeholder
    NextMatchEntry.empty
}

#Preview(as: .systemMedium) {
    NextMatchWidget()
} timeline: {
    NextMatchEntry.placeholder
    NextMatchEntry.empty
}
