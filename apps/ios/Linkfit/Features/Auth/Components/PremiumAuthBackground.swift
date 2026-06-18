import SwiftUI

/// Auth background.
///
/// Keep auth calm and native: the form, logo, and CTA carry hierarchy.
/// Earlier versions used animated blue/lime glows, which made the app read
/// like a generic AI product instead of a practical sports tool.
struct PremiumAuthBackground: View {
    var body: some View {
        DSColor.background
            .ignoresSafeArea()
    }
}

#Preview {
    PremiumAuthBackground()
}
