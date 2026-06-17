import SwiftUI

public extension View {
    /// Soft two-layer card shadow (web `--shadow-card`). Black shadows are
    /// near-invisible on the dark canvas, so dark mode leans on tone + border
    /// (added by `dsCard()`); this is intentional, not a bug.
    func dsCardShadow() -> some View {
        self
            .shadow(color: .black.opacity(0.04), radius: 1, x: 0, y: 1)
            .shadow(color: .black.opacity(0.10), radius: 12, x: 0, y: 8)
    }

    /// Blue-tinted CTA shadow (web `--shadow-cta`) — gives primary buttons lift.
    func dsCTAShadow() -> some View {
        self.shadow(color: DSColor.accent.opacity(0.45), radius: 13, x: 0, y: 8)
    }

    /// Stronger lift for floating / pinned surfaces (sheets, join bars).
    func dsLiftShadow() -> some View {
        self
            .shadow(color: .black.opacity(0.08), radius: 3, x: 0, y: 2)
            .shadow(color: .black.opacity(0.18), radius: 22, x: 0, y: 18)
    }
}
