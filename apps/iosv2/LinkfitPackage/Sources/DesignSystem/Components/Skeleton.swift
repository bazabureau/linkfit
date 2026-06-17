import SwiftUI

/// Quiet, token-based shimmer placeholder. Honors Reduce Motion (static fill).
public struct Skeleton: View {
    private let cornerRadius: CGFloat
    @State private var shimmer = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(cornerRadius: CGFloat = DSRadius.chip) {
        self.cornerRadius = cornerRadius
    }

    public var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(DSColor.surface2)
            .overlay {
                if !reduceMotion {
                    LinearGradient(
                        colors: [.clear, DSColor.border.opacity(0.6), .clear],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .offset(x: shimmer ? 220 : -220)
                    .mask(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                }
            }
            .clipped()
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) {
                    shimmer = true
                }
            }
    }
}

/// A few stacked skeleton rows for list loading states.
public struct SkeletonList: View {
    private let rows: Int
    public init(rows: Int = 4) { self.rows = rows }

    public var body: some View {
        VStack(spacing: DSSpacing.m) {
            ForEach(0..<rows, id: \.self) { _ in
                Skeleton(cornerRadius: DSRadius.card)
                    .frame(height: 76)
            }
        }
    }
}

#Preview {
    SkeletonList()
        .padding()
        .background(DSColor.canvas)
}
