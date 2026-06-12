import SwiftUI

/// Toolbar button that lets the user place an "@" mention chip on the
/// current story photo.
///
/// Contract:
///   • Type is `struct MentionToolButton: View` — the story editor's
///     toolbar references this name directly (see Wave-12 integration
///     contract), so do NOT rename without updating the editor too.
///   • Takes a `Binding<[StoryOverlay]>` so the button can append a fresh
///     `.mention(...)` overlay in place once the user picks a follower.
///     The editor canvas re-renders against the bound array and gestures
///     pick up the new chip on the next frame.
///
/// Visual: a simple "@" glyph button styled to match the other story
/// editor tool buttons (text "Aa", sticker emoji, etc.). The actual
/// pixel-level chrome is owned by the editor — we render an SF symbol
/// inside an accessible button so the editor can drop us inline without
/// fighting a custom background.
///
/// Selected follower → fresh overlay at the canvas centre (x=0.5, y=0.5),
/// scale 1, rotation 0. The user then drags / rotates / removes via the
/// gesture layer above.
struct MentionToolButton: View {
    @Binding var overlays: [StoryOverlay]
    @State private var showPicker = false

    var body: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            showPicker = true
        } label: {
            // The "@" glyph reads cleaner as a Text label than as an SF
            // Symbol — SF's `at` symbol exists but is visually thin against
            // the deep ink canvas. A heavy rounded "@" matches the
            // typographic weight of the other tool buttons ("Aa", emoji,
            // etc.).
            Text(verbatim: "@")
                .font(.system(size: 22, weight: .heavy, design: .default))
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(
                    Circle().fill(Color.black.opacity(0.35))
                )
                .overlay(
                    Circle().strokeBorder(.white.opacity(0.18), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("stories.mention.tool.label"))
        .sheet(isPresented: $showPicker) {
            StoryMentionPickerSheet { user in
                let chip = StoryMentionOverlay(
                    id: UUID(),
                    user_id: user.id,
                    display_name: user.display_name,
                    avatar_url: user.avatar_url,
                    x: 0.5,
                    y: 0.5,
                    scale: 1,
                    rotation: 0
                )
                overlays.append(.mention(chip))
                showPicker = false
            }
        }
    }
}
