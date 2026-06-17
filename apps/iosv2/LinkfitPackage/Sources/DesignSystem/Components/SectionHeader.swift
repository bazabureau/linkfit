import SwiftUI

/// A section title with an optional eyebrow and an optional trailing accessory
/// (e.g. a "See all" button). Heading weight alone conveys hierarchy.
public struct SectionHeader<Trailing: View>: View {
    private let title: LocalizedStringKey
    private let eyebrow: LocalizedStringKey?
    private let trailing: Trailing

    public init(
        _ title: LocalizedStringKey,
        eyebrow: LocalizedStringKey? = nil,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.title = title
        self.eyebrow = eyebrow
        self.trailing = trailing()
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: DSSpacing.xs) {
                if let eyebrow { Eyebrow(eyebrow) }
                Text(title)
                    .font(DSFont.section)
                    .foregroundStyle(DSColor.textPrimary)
            }
            Spacer(minLength: DSSpacing.m)
            trailing
        }
    }
}

public extension SectionHeader where Trailing == EmptyView {
    init(_ title: LocalizedStringKey, eyebrow: LocalizedStringKey? = nil) {
        self.init(title, eyebrow: eyebrow) { EmptyView() }
    }
}

#Preview {
    VStack(spacing: 20) {
        SectionHeader("Your next game", eyebrow: "Upcoming")
        SectionHeader("Nearby") {
            Button("See all") {}.font(DSFont.caption).foregroundStyle(DSColor.accent)
        }
    }
    .padding()
    .background(DSColor.canvas)
}
