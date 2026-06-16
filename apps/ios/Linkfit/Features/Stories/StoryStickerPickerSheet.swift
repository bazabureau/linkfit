import SwiftUI

/// Half-height bottom sheet showing a curated emoji grid for the story
/// sticker tool. Tap any glyph → `onSelect(emoji)` fires and the host
/// (W12-2's editor toolbar) closes the sheet + appends a sticker overlay.
///
/// Layout: a sticky search field at the top, a 6-column `LazyVGrid` of
/// large emoji buttons below. The grid is `LazyVGrid` rather than a
/// flat `ScrollView` so 60+ glyphs don't all instantiate at once — the
/// sheet pops fast and scrolls smoothly.
///
/// **Curation.** The list mixes padel-relevant (`🎾🏆🥇🥈🥉🏟️💪🏋️‍♂️🏃‍♂️`),
/// celebratory (`🎉🥳👏🙌🚀✨💥`), reaction (`😎🔥💯❤️💚😂🤩😱💀👀😀…`),
/// and a handful of generic symbols (`👍👎🙏🤝🧠⚡⭐`). Each glyph is paired
/// with a Latin-script search keyword so the search field works in any
/// locale — we don't depend on the system Unicode names which would be
/// localized differently and break a search-by-"ball" query in AZ/RU.
struct StoryStickerPickerSheet: View {
    /// Fired when the user taps a glyph. The host is responsible for
    /// dismissing the sheet — we don't call `dismiss()` ourselves so the
    /// host can sequence sheet-close + overlay-append in whichever order
    /// keeps the editor canvas's selection state coherent.
    let onSelect: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query: String = ""

    /// 6-column grid — matches Instagram's emoji-sheet density at a phone
    /// width while still leaving each glyph button comfortably tappable
    /// (44pt minimum). `LazyVGrid` virtualizes off-screen rows.
    private let columns: [GridItem] = Array(
        repeating: GridItem(.flexible(), spacing: 8),
        count: 6
    )

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(filtered, id: \.glyph) { entry in
                        Button {
                            Haptics.selection()
                            onSelect(entry.glyph)
                        } label: {
                            Text(entry.glyph)
                                .font(.system(size: 32))
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .frame(height: 56)
                                .background(
                                    RoundedRectangle(
                                        cornerRadius: DSRadius.md,
                                        style: .continuous
                                    )
                                    .fill(DSColor.surfaceElevated)
                                )
                                // Larger hit area than the visible square
                                // so fat-finger taps near the edge still
                                // register on the right glyph.
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 12)
            }
            .background(DSColor.background)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(Text("stories.sticker.picker.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("common.cancel") { dismiss() }
                        .tint(DSColor.textPrimary)
                }
            }
            // `.searchable` gives us free keyboard handling, a system
            // cancel button, and proper "search" return-key affordances
            // for free — better than a hand-rolled `TextField`.
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text("stories.sticker.picker.search")
            )
        }
        // Half-height presentation matches the rest of the editor's
        // bottom-sheet language (text-tool sheet, mention picker).
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(DSColor.background)
    }

    /// Filtered curated set based on `query`. Match is case-insensitive
    /// against the keyword string. An empty query returns the full list
    /// in curation order (padel-first, see `Self.curated`).
    private var filtered: [Entry] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return Self.curated }
        let needle = trimmed.lowercased()
        return Self.curated.filter { entry in
            entry.keyword.lowercased().contains(needle)
        }
    }

    // MARK: - Curated set

    /// Single curated entry. Keyword is intentionally Latin-script English
    /// so the search field's match remains stable regardless of the user's
    /// app locale — a Russian-speaking user typing "ball" still finds 🎾.
    /// Localized labels could be added later by swapping `keyword` for an
    /// array, but that's a follow-up.
    fileprivate struct Entry: Hashable {
        let glyph: String
        let keyword: String
    }

    /// Curation order — padel-relevant glyphs lead so the most common
    /// story decoration (a ball, a trophy, flexed arm) is one tap away
    /// without scrolling. ~60 entries, comfortably fitting two scroll
    /// pages on a 6.1" device.
    fileprivate static let curated: [Entry] = [
        // Padel + sport
        .init(glyph: "\u{1F3BE}", keyword: "padel ball tennis"),
        .init(glyph: "\u{1F3C6}", keyword: "trophy winner champion"),
        .init(glyph: "\u{1F947}", keyword: "gold medal first"),
        .init(glyph: "\u{1F948}", keyword: "silver medal second"),
        .init(glyph: "\u{1F949}", keyword: "bronze medal third"),
        .init(glyph: "\u{1F3DF}\u{FE0F}", keyword: "stadium arena court"),
        .init(glyph: "\u{1F4AA}", keyword: "muscle strong flex"),
        .init(glyph: "\u{1F3CB}\u{FE0F}\u{200D}\u{2642}\u{FE0F}", keyword: "lift workout gym"),
        .init(glyph: "\u{1F3C3}\u{200D}\u{2642}\u{FE0F}", keyword: "run running fast"),
        .init(glyph: "\u{26BD}", keyword: "soccer ball football"),
        .init(glyph: "\u{1F3AF}", keyword: "target bullseye aim"),

        // Reactions + celebrations
        .init(glyph: "\u{1F525}", keyword: "fire hot lit"),
        .init(glyph: "\u{1F4AF}", keyword: "100 hundred perfect"),
        .init(glyph: "\u{1F389}", keyword: "party celebration tada"),
        .init(glyph: "\u{1F44F}", keyword: "clap applause"),
        .init(glyph: "\u{2764}\u{FE0F}", keyword: "heart love red"),
        .init(glyph: "\u{1F49A}", keyword: "green heart linkfit"),
        .init(glyph: "\u{1F973}", keyword: "party face celebrate"),
        .init(glyph: "\u{1F602}", keyword: "joy laugh tears"),
        .init(glyph: "\u{1F929}", keyword: "star struck excited"),
        .init(glyph: "\u{1F631}", keyword: "scream shock surprise"),
        .init(glyph: "\u{1F480}", keyword: "skull dead lol"),
        .init(glyph: "\u{1F440}", keyword: "eyes look watch"),
        .init(glyph: "\u{1F64C}", keyword: "raised hands praise"),
        .init(glyph: "\u{1F680}", keyword: "rocket launch fast"),
        .init(glyph: "\u{2728}", keyword: "sparkles shine magic"),
        .init(glyph: "\u{1F4A5}", keyword: "boom explosion impact"),
        .init(glyph: "\u{1F91D}", keyword: "handshake deal team"),
        .init(glyph: "\u{1F9E0}", keyword: "brain smart think"),

        // Faces
        .init(glyph: "\u{1F600}", keyword: "smile happy grin"),
        .init(glyph: "\u{1F605}", keyword: "sweat smile relief"),
        .init(glyph: "\u{1F60D}", keyword: "heart eyes love"),
        .init(glyph: "\u{1F618}", keyword: "kiss blow"),
        .init(glyph: "\u{1F60B}", keyword: "yum tongue tasty"),
        .init(glyph: "\u{1F914}", keyword: "thinking hmm"),
        .init(glyph: "\u{1F634}", keyword: "sleeping tired sleep"),
        .init(glyph: "\u{1F60E}", keyword: "cool sunglasses smug"),
        .init(glyph: "\u{1F644}", keyword: "eye roll annoyed"),
        .init(glyph: "\u{1F62D}", keyword: "cry sob tears"),
        .init(glyph: "\u{1F60F}", keyword: "smirk sly"),
        .init(glyph: "\u{1F92F}", keyword: "mind blown explode"),

        // Hands + symbols
        .init(glyph: "\u{1F44D}", keyword: "thumbs up like yes"),
        .init(glyph: "\u{1F44E}", keyword: "thumbs down no"),
        .init(glyph: "\u{1F64F}", keyword: "pray thanks please"),
        .init(glyph: "\u{1F44A}", keyword: "fist bump punch"),
        .init(glyph: "\u{270C}\u{FE0F}", keyword: "peace victory"),
        .init(glyph: "\u{1F90C}", keyword: "pinch small tiny"),
        .init(glyph: "\u{1F91F}", keyword: "love you rock"),
        .init(glyph: "\u{1F448}", keyword: "point left"),
        .init(glyph: "\u{1F449}", keyword: "point right"),
        .init(glyph: "\u{1F446}", keyword: "point up arrow"),
        .init(glyph: "\u{1F447}", keyword: "point down arrow"),
        .init(glyph: "\u{26A1}", keyword: "lightning bolt power"),
        .init(glyph: "\u{2B50}", keyword: "star favorite"),
        .init(glyph: "\u{1F319}", keyword: "moon night"),
        .init(glyph: "\u{2600}\u{FE0F}", keyword: "sun sunny day"),
        .init(glyph: "\u{1F4A8}", keyword: "dash speed wind"),
        .init(glyph: "\u{1F4AC}", keyword: "speech bubble talk chat"),
        .init(glyph: "\u{2705}", keyword: "check done yes"),
        .init(glyph: "\u{274C}", keyword: "cross no wrong"),
        .init(glyph: "\u{2049}\u{FE0F}", keyword: "interrobang"),
    ]
}
