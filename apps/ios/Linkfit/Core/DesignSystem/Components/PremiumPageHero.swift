import SwiftUI

/// Reusable premium hero block for full-screen flows (Create Game,
/// Matches, Tournaments, Profile…). Pairs a lime-tinted icon medallion
/// with a heavy title and supporting subtitle. Renders flush to the
/// page padding so callers don't need to wrap it in extra HStacks.
///
/// Layout:
///   [icon medallion]   [title (heavy 24pt)]
///                      [subtitle (regular 14pt, two-line max)]
///
/// Override `alignment` to `.center` for sheet/modal screens where the
/// hero should sit centred (Create Game does this); leave default for
/// page heroes like Matches/Profile.
struct PremiumPageHero: View {
    let icon: String
    let titleKey: LocalizedStringKey
    let subtitleKey: LocalizedStringKey?
    var alignment: HorizontalAlignment = .leading
    /// Optional override — defaults to the brand accent.
    var accent: Color = DSColor.accent

    var body: some View {
        VStack(alignment: alignment, spacing: 14) {
            medallion

            VStack(alignment: alignment, spacing: 6) {
                Text(titleKey)
                    .font(.system(size: 26, weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(alignment == .center ? .center : .leading)
                    .fixedSize(horizontal: false, vertical: true)

                if let subtitleKey {
                    Text(subtitleKey)
                        .font(.system(size: 14, weight: .regular, design: .default))
                        .foregroundStyle(DSColor.textSecondary)
                        .multilineTextAlignment(alignment == .center ? .center : .leading)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: alignment == .center ? .center : .leading)
    }

    private var medallion: some View {
        ZStack {
            Circle()
                .fill(accent.opacity(0.18))
                .frame(width: 60, height: 60)
            Circle()
                .strokeBorder(accent.opacity(0.45), lineWidth: 1)
                .frame(width: 60, height: 60)
            Image(systemName: icon)
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(accent)
        }
    }
}
