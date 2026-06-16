import SwiftUI
import CoreGraphics

/// Persisted state for a single "@" mention chip placed on the story canvas.
///
/// The shape is locked by the Wave-12 contract — `StoryOverlay.mention(StoryMentionOverlay)`
/// is declared in `StoryOverlay.swift` (W12-2) and rendered by the story editor's
/// canvas layer (W12-1). The field set must match the contract exactly so the
/// editor compiles regardless of which agent's file lands first.
///
/// Why a chip (instead of plain "@handle" text in a text overlay)? A chip is
/// the standard Instagram metaphor — it's tappable, deletable, and visually
/// distinct from caption text, which lets the server later resolve mentions
/// without a regex-on-text pass at upload time. The chip's normalized x/y/
/// scale/rotation come from `StoryOverlayPayload` so the same transform
/// gestures the text/sticker tools use apply unchanged here.
///
/// `display_name` is captured at the moment of tagging (not looked up at
/// render time) so the chip stays stable even if the tagged user later
/// changes their display name. Server resolves the chip back to `user_id`
/// when computing notifications + linking from the rendered story.
struct StoryMentionOverlay: StoryOverlayPayload {
    let id: UUID
    /// Server-side user id — opaque to the client; used by the upload payload
    /// to tell the server who got mentioned without a name-resolution round
    /// trip.
    let user_id: String
    /// Snapshot of the tagged user's display name. Mutable in case the
    /// editor ever lets the user re-name a chip inline (not currently
    /// surfaced), and to satisfy the locked contract which declares it
    /// `var`.
    var display_name: String
    /// Avatar URL captured at tag time. Optional — placeholder avatars fall
    /// back to coloured initials in the chip.
    var avatar_url: String?
    var x: CGFloat
    var y: CGFloat
    var scale: CGFloat
    var rotation: Double

    init(
        id: UUID = UUID(),
        user_id: String,
        display_name: String,
        avatar_url: String? = nil,
        x: CGFloat = 0.5,
        y: CGFloat = 0.5,
        scale: CGFloat = 1.0,
        rotation: Double = 0
    ) {
        self.id = id
        self.user_id = user_id
        self.display_name = display_name
        self.avatar_url = avatar_url
        self.x = x
        self.y = y
        self.scale = scale
        self.rotation = rotation
    }
}

// MARK: - Renderable view

/// Pure-presentation view for a mention chip on the canvas.
///
/// Visual:
///   • Pill: `DSColor.accent` (royal blue) background, `DSColor.textOnAccent` ink.
///   • Optional avatar prefix at 18pt circle — falls back to coloured
///     initials when `avatar_url` is missing or fails to load.
///   • Glyph text uses an explicit "@%@" format pulled from the localization
///     so RTL locales (none currently shipped, but the codebase supports
///     adding them) can flip the @ to the trailing edge if their writing
///     system demands it.
///   • Active state draws a faint dashed handle ring so users can see they
///     can grab the chip; matches the affordance shape used by the text
///     overlay's active state for visual consistency.
///
/// Tap & double-tap gestures are NOT attached here — they belong on the
/// gesture layer in the editor canvas (W12-1) which wraps the chip in the
/// same drag/rotate/scale layer that text/stickers use. Keeping the chip
/// presentational keeps test scaffolding cheap (the view renders in
/// previews without a parent gesture environment).
struct StoryMentionOverlayView: View {
    let overlay: StoryMentionOverlay
    /// Whether the chip is the currently-selected overlay in the editor.
    /// Active = a dashed handle ring + slightly brighter shadow so the user
    /// sees which chip will respond to the toolbar's delete action.
    var isActive: Bool

    var body: some View {
        HStack(spacing: 6) {
            avatar
            Text(String(format: String(localized: "stories.mention.chip.format"),
                        overlay.display_name))
                .font(DSType.cardTitle)
                .foregroundStyle(DSColor.textOnAccent)
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            Capsule(style: .continuous)
                .fill(DSColor.accent)
                .shadow(color: DSColor.accent.opacity(isActive ? 0.55 : 0.25),
                        radius: isActive ? 10 : 6, y: 2)
        )
        .overlay(
            Capsule(style: .continuous)
                .strokeBorder(
                    DSColor.textOnAccent.opacity(isActive ? 0.9 : 0),
                    style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])
                )
                .padding(-3)
                .allowsHitTesting(false)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(String(format: String(localized: "stories.mention.chip.format"),
                                        overlay.display_name)))
        .accessibilityHint(Text("stories.mention.remove"))
    }

    // MARK: - Avatar prefix

    @ViewBuilder
    private var avatar: some View {
        ZStack {
            // Fallback medallion behind the async image — guarantees a
            // visible circle even before the URL resolves (or when it
            // fails entirely).
            Circle()
                .fill(DSColor.textOnAccent.opacity(0.18))
            if let urlString = overlay.avatar_url,
               let url = URL(string: urlString) {
                CachedAsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initialsLabel
                }
            } else {
                initialsLabel
            }
        }
        .frame(width: 18, height: 18)
        .clipShape(Circle())
    }

    private var initialsLabel: some View {
        Text(initials(overlay.display_name))
            .font(.system(size: 9, weight: .heavy, design: .default))
            .foregroundStyle(DSColor.textOnAccent)
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        let joined = parts.joined()
        return joined.isEmpty ? "@" : joined
    }
}

// MARK: - View builder hook on the payload

extension StoryMentionOverlay {
    /// Convenience builder so the editor canvas can write
    /// `overlay.view(isActive: …)` directly without spelling out the view
    /// type. Returns an `AnyView` only because the contract surface said
    /// "expose a `view(isActive:)` builder" — keeping the return type erased
    /// lets callers stash the result in a heterogeneous overlay list.
    @MainActor
    func view(isActive: Bool) -> some View {
        StoryMentionOverlayView(overlay: self, isActive: isActive)
    }
}
