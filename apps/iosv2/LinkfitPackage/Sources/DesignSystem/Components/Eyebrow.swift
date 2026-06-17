import SwiftUI

/// Sentence-case accent label with a leading dot — the web "Eyebrow". Replaces
/// uppercase kickers (which are banned). Pair above a `SectionHeader` title.
public struct Eyebrow: View {
    public enum Tone { case accent, lime }

    private let text: LocalizedStringKey
    private let tone: Tone

    public init(_ text: LocalizedStringKey, tone: Tone = .accent) {
        self.text = text
        self.tone = tone
    }

    public var body: some View {
        HStack(spacing: DSSpacing.s) {
            Circle()
                .fill(tone == .lime ? DSColor.lime : DSColor.accent)
                .frame(width: 6, height: 6)
            Text(text)
                .font(DSFont.caption)
                .foregroundStyle(tone == .lime ? DSColor.textMuted : DSColor.accent)
        }
    }
}

#Preview {
    VStack(alignment: .leading, spacing: 10) {
        Eyebrow("Near you")
        Eyebrow("New season", tone: .lime)
    }
    .padding()
    .background(DSColor.canvas)
}
