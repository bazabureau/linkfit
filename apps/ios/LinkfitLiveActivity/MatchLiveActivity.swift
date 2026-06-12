// MatchLiveActivity.swift
//
// SwiftUI presentation layer for an in-progress Linkfit match.
//
// Layouts:
//   • Lock-screen banner   — full-width score card with a stylised
//                            court silhouette, team names, big score.
//   • Dynamic Island
//       compact leading    — a lime dot (the brand accent).
//       compact trailing   — current set score "A-B".
//       minimal            — small score chip, used when multiple
//                            activities collapse into one pill.
//       expanded           — full layout: per-team score column,
//                            "Set N" label, elapsed `.timer`.
//
// ReduceMotion: we DO NOT use `.animation` or `.transition` on the
// score numbers themselves. The system handles cross-state morphing
// between Island leaves on its own; adding a scale animation on top
// would defy `accessibilityReduceMotion` users (and frankly looks
// jittery on real hardware when sets tick at irregular intervals).

import ActivityKit
import SwiftUI
import WidgetKit

struct MatchLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MatchActivityAttributes.self) { context in
            // Lock-screen / banner presentation.
            LockScreenBanner(
                attributes: context.attributes,
                state: context.state
            )
            .activityBackgroundTint(Color.black.opacity(0.85))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    ExpandedTeamColumn(
                        name: context.attributes.teamA,
                        sets: context.state.setsA,
                        games: context.state.currentGameA,
                        point: context.state.pointA,
                        isServing: context.state.servingTeam == .a,
                        alignment: .leading
                    )
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ExpandedTeamColumn(
                        name: context.attributes.teamB,
                        sets: context.state.setsB,
                        games: context.state.currentGameB,
                        point: context.state.pointB,
                        isServing: context.state.servingTeam == .b,
                        alignment: .trailing
                    )
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 2) {
                        Text("Set \(context.state.currentSetIndex + 1)")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(timerInterval: context.state.startedAt...Date.distantFuture,
                             countsDown: false)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.center)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if context.state.isCompleted {
                        Text("Final")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(LiveActivityPalette.lime)
                    }
                }
            } compactLeading: {
                // Lime dot doubles as the serve indicator when one side is
                // serving — slightly larger and a touch brighter so users
                // glancing at the Island can tell at a distance.
                Circle()
                    .fill(LiveActivityPalette.lime)
                    .frame(
                        width: context.state.servingTeam == .a ? 10 : 8,
                        height: context.state.servingTeam == .a ? 10 : 8
                    )
                    .accessibilityLabel(
                        context.state.servingTeam == .a
                        ? "Linkfit live match, Team A serving"
                        : "Linkfit live match"
                    )
            } compactTrailing: {
                HStack(spacing: 4) {
                    Text("\(context.state.setsA)-\(context.state.setsB)")
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .foregroundStyle(.primary)
                    // Serve indicator on the trailing side renders only
                    // when team B is serving — keeps the leaf uncluttered.
                    if context.state.servingTeam == .b {
                        Circle()
                            .fill(LiveActivityPalette.lime)
                            .frame(width: 6, height: 6)
                            .accessibilityLabel("Team B serving")
                    }
                }
            } minimal: {
                Text("\(context.state.setsA)-\(context.state.setsB)")
                    .font(.caption2.monospacedDigit().weight(.bold))
                    .foregroundStyle(LiveActivityPalette.lime)
            }
            .keylineTint(LiveActivityPalette.lime)
            .widgetURL(URL(string: "linkfit://match/\(context.attributes.gameId)"))
        }
    }
}

// MARK: - Lock-screen banner

private struct LockScreenBanner: View {
    let attributes: MatchActivityAttributes
    let state: MatchActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 14) {
            CourtSilhouette()
                .frame(width: 56, height: 36)
                .foregroundStyle(LiveActivityPalette.lime.opacity(0.85))

            VStack(alignment: .leading, spacing: 4) {
                TeamNameRow(
                    name: attributes.teamA,
                    isServing: state.servingTeam == .a,
                    accessibilitySuffix: "Team A"
                )
                TeamNameRow(
                    name: attributes.teamB,
                    isServing: state.servingTeam == .b,
                    accessibilitySuffix: "Team B"
                )
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 2) {
                BigScoreRow(
                    sets: state.setsA,
                    games: state.currentGameA,
                    point: state.pointA
                )
                BigScoreRow(
                    sets: state.setsB,
                    games: state.currentGameB,
                    point: state.pointB
                )
                if state.isCompleted {
                    Text("Final")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(LiveActivityPalette.lime)
                } else {
                    Text("Set \(state.currentSetIndex + 1): \(state.currentGameA)-\(state.currentGameB)")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.white.opacity(0.65))
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }
}

/// Team name + optional serve dot. Pulled out so the leading column on
/// the lock-screen banner can render an inline serving indicator without
/// disturbing the existing baseline alignment of the score column on the
/// right.
private struct TeamNameRow: View {
    let name: String
    let isServing: Bool
    let accessibilitySuffix: String

    var body: some View {
        HStack(spacing: 6) {
            Text(name)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
            if isServing {
                Circle()
                    .fill(LiveActivityPalette.lime)
                    .frame(width: 6, height: 6)
                    .accessibilityLabel("\(accessibilitySuffix) serving")
            }
        }
    }
}

private struct BigScoreRow: View {
    let sets: Int
    let games: Int
    let point: Int

    var body: some View {
        HStack(spacing: 10) {
            Text("\(sets)")
                .font(.title3.monospacedDigit().weight(.heavy))
                .foregroundStyle(LiveActivityPalette.lime)
            Text("\(games)")
                .font(.body.monospacedDigit().weight(.semibold))
                .foregroundStyle(.white)
            Text(MatchActivityAttributes.ContentState.pointLabel(point))
                .font(.caption.monospacedDigit().weight(.medium))
                .foregroundStyle(.white.opacity(0.7))
                .frame(minWidth: 22, alignment: .trailing)
        }
        // No `.animation` here — see ReduceMotion note at the top.
    }
}

// MARK: - Expanded leaf columns

private struct ExpandedTeamColumn: View {
    let name: String
    let sets: Int
    let games: Int
    let point: Int
    let isServing: Bool
    let alignment: HorizontalAlignment

    var body: some View {
        VStack(alignment: alignment, spacing: 4) {
            // Team-name row gets the serve dot — inlined so the dot
            // collapses cleanly when no team is serving (between games)
            // without leaving a blank column gap.
            HStack(spacing: 5) {
                if alignment == .leading && isServing {
                    serveDot
                }
                Text(name)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if alignment == .trailing && isServing {
                    serveDot
                }
            }
            HStack(spacing: 6) {
                Text("\(sets)")
                    .font(.title2.monospacedDigit().weight(.heavy))
                    .foregroundStyle(LiveActivityPalette.lime)
                Text("\(games)")
                    .font(.body.monospacedDigit().weight(.semibold))
                    .foregroundStyle(.primary)
                Text(MatchActivityAttributes.ContentState.pointLabel(point))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity,
               alignment: alignment == .leading ? .leading : .trailing)
    }

    private var serveDot: some View {
        Circle()
            .fill(LiveActivityPalette.lime)
            .frame(width: 6, height: 6)
            .accessibilityLabel("\(name) serving")
    }
}

// MARK: - Court silhouette

/// Minimal stylised tennis-court outline — net + baselines.
/// Drawn as a `Shape` so it scales crisply at any DPI and respects the
/// surrounding `foregroundStyle` tint.
private struct CourtSilhouette: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        // Outer court.
        p.addRoundedRect(in: rect, cornerSize: CGSize(width: 3, height: 3))
        // Centre net.
        let midX = rect.midX
        p.move(to: CGPoint(x: midX, y: rect.minY))
        p.addLine(to: CGPoint(x: midX, y: rect.maxY))
        // Service lines.
        let inset = rect.width * 0.18
        p.move(to: CGPoint(x: rect.minX + inset, y: rect.midY))
        p.addLine(to: CGPoint(x: rect.maxX - inset, y: rect.midY))
        return p.strokedPath(StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round))
    }
}

// MARK: - Palette

/// Local palette for the widget extension. Cannot import the main
/// app's `DSColor` enum because widget extensions don't link the app
/// binary; values here mirror the brand lime token.
enum LiveActivityPalette {
    static let lime = Color(red: 200 / 255, green: 247 / 255, blue: 70 / 255)
}
