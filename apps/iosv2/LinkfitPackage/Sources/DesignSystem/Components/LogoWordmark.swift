import SwiftUI

/// Text wordmark for splash / auth. Uses the Plus Jakarta display face when the
/// font resource is bundled (echoing the website), else a heavy system fallback.
/// The "fit" is set in the lime energy accent.
public struct LogoWordmark: View {
    private let size: CGFloat

    public init(size: CGFloat = 32) {
        self.size = size
    }

    public var body: some View {
        HStack(spacing: 0) {
            Text("link")
                .foregroundStyle(DSColor.textPrimary)
            Text("fit")
                .foregroundStyle(DSColor.accent)
        }
        .font(DSFont.wordmark(size: size))
        .accessibilityLabel("Linkfit")
    }
}

#Preview {
    VStack(spacing: 24) {
        LogoWordmark(size: 28)
        LogoWordmark(size: 44)
    }
    .padding()
    .background(DSColor.canvas)
}
