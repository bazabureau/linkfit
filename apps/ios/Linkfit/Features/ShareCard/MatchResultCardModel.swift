import Foundation
import SwiftUI

/// Layout variant for the shareable result card.
///
/// - `square`: 1080×1080 — Instagram feed, Telegram, WhatsApp Status thumbnails.
/// - `story`:  1080×1920 — Instagram / Snapchat / WhatsApp Status full screen.
///
/// Both export at 3x scale through the same SwiftUI view to guarantee the
/// design system stays in lock-step with the in-app screens.
enum ShareCardVariant: Sendable, Equatable {
    case square
    case story

    /// Logical (point) size that the SwiftUI view is laid out at. The
    /// `ImageRenderer` multiplies by the device scale (3.0) when rasterising.
    var pointSize: CGSize {
        switch self {
        case .square: return CGSize(width: 360, height: 360)
        case .story:  return CGSize(width: 360, height: 640)
        }
    }

    /// Pixel size that the resulting PNG should be when exported at 3x.
    /// Used purely for documentation and for tests to sanity-check the
    /// canvas — the renderer derives the value from `pointSize × scale`.
    var pixelSize: CGSize {
        CGSize(width: pointSize.width * 3, height: pointSize.height * 3)
    }
}

/// W/L/D outcome — drives the colour and headline of the result tag.
enum MatchOutcome: String, Sendable, Equatable {
    case win
    case loss
    case draw

    var accent: Color {
        switch self {
        case .win:  return DSColor.accent
        case .loss: return DSColor.danger
        case .draw: return DSColor.info
        }
    }

    /// Localised three-letter banner ("WIN" / "LOSS" / "DRAW").
    /// Localisation keys live under `_section.share_card_agent` in
    /// `Localizable.xcstrings`.
    var bannerKey: LocalizedStringKey {
        switch self {
        case .win:  return "share_card.banner.win"
        case .loss: return "share_card.banner.loss"
        case .draw: return "share_card.banner.draw"
        }
    }
}

/// A single player slot on the card.
///
/// `isSelf` causes the player chip to render with the lime brand accent so
/// the sender stands out at a glance — Strava-style highlighting.
/// `isHost` is used by `GameJoinedCard` to render a subtle "Host" caption
/// under the chip, matching the way the in-app participants list flags
/// the host.
struct ShareCardPlayer: Sendable, Equatable, Identifiable {
    let id: String
    let displayName: String
    let avatarURL: URL?
    let isSelf: Bool
    let isHost: Bool

    init(
        id: String,
        displayName: String,
        avatarURL: URL? = nil,
        isSelf: Bool = false,
        isHost: Bool = false
    ) {
        self.id = id
        self.displayName = displayName
        self.avatarURL = avatarURL
        self.isSelf = isSelf
        self.isHost = isHost
    }
}

/// Everything the result-card view needs to render.
///
/// Held immutable so the renderer can pass it across actor hops safely.
struct ShareCardData: Sendable, Equatable {
    let outcome: MatchOutcome
    /// Sender's team score on the left.
    let scoreSelf: Int
    /// Opponent / other team score on the right.
    let scoreOpponent: Int
    /// "Self" team (left column) — usually 1–2 players.
    let selfTeam: [ShareCardPlayer]
    /// Opponents (right column) — usually 1–2 players.
    let opponents: [ShareCardPlayer]
    /// "Padel · Olympic Arena" / "Tennis · Court 4". Kept short — the card
    /// will truncate gracefully but a punchy 1-liner reads best.
    let sportAndVenue: String
    /// The match date — formatted at render time so the locale matches the
    /// device language.
    let date: Date
    /// ELO delta. Positive numbers render with a leading "+"; negative with
    /// a leading "−" (true minus, not hyphen). Pass `nil` to hide the badge.
    let eloChange: Int?
    /// Optional deep-link / web URL printed in the footer for QR-less devices
    /// or as a fallback when QR generation is impractical.
    let shareURL: URL?

    init(
        outcome: MatchOutcome,
        scoreSelf: Int,
        scoreOpponent: Int,
        selfTeam: [ShareCardPlayer],
        opponents: [ShareCardPlayer],
        sportAndVenue: String,
        date: Date,
        eloChange: Int? = nil,
        shareURL: URL? = nil
    ) {
        self.outcome = outcome
        self.scoreSelf = scoreSelf
        self.scoreOpponent = scoreOpponent
        self.selfTeam = selfTeam
        self.opponents = opponents
        self.sportAndVenue = sportAndVenue
        self.date = date
        self.eloChange = eloChange
        self.shareURL = shareURL
    }
}

extension ShareCardData {
    /// Lightweight sample used by SwiftUI previews and unit tests so we
    /// don't pull random fixtures from the network during builds.
    static let preview = ShareCardData(
        outcome: .win,
        scoreSelf: 6,
        scoreOpponent: 4,
        selfTeam: [
            ShareCardPlayer(id: "u1", displayName: "Kamran N.", avatarURL: nil, isSelf: true),
            ShareCardPlayer(id: "u2", displayName: "Elvin G.")
        ],
        opponents: [
            ShareCardPlayer(id: "u3", displayName: "Rauf M."),
            ShareCardPlayer(id: "u4", displayName: "Tural A.")
        ],
        sportAndVenue: "Padel · Olympic Arena",
        date: Date(timeIntervalSince1970: 1_715_000_000),
        eloChange: 18,
        shareURL: URL(string: "https://linkfit.az/g/abc123")
    )
}
