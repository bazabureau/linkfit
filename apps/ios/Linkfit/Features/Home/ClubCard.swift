import SwiftUI

/// Venue card for the nearby clubs carousel.
struct ClubCard: View {
    let venue: Venue
    var onTap: () -> Void = {}

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: DSSpacing.sm) {
                artwork
                    .frame(height: 124)
                    .clipShape(RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous))
                    .overlay(alignment: .topLeading) {
                        if venue.is_partner {
                            Text("venues.partner")
                                .font(.system(.caption2, design: .default, weight: .semibold))
                                .foregroundStyle(DSColor.textOnAccent)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 5)
                                .background(Capsule().fill(DSColor.accent))
                                .padding(10)
                        }
                    }

                VStack(alignment: .leading, spacing: 7) {
                    Text(venue.name)
                        .font(.system(.subheadline, design: .default, weight: .semibold))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)

                    Text(venue.address)
                        .font(.system(.caption, design: .default))
                        .foregroundStyle(DSColor.textSecondary)
                        .lineLimit(1)

                    HStack(spacing: 6) {
                        Image(systemName: "location")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(DSColor.textTertiary)
                        Text(distanceLabel)
                            .font(.system(.caption, design: .default, weight: .medium))
                            .foregroundStyle(DSColor.textSecondary)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(DSColor.textTertiary)
                    }
                }
            }
            .padding(10)
            .frame(width: 232, alignment: .leading)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                    .strokeBorder(DSColor.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("\(venue.name), \(venue.address), \(distanceLabel)"))
    }

    /// Render the real cover photo when the venue has one (FAZA 50
    /// added `photo_urls` + `photo_url`). Falls back to the
    /// court-line illustration only for venues with no uploaded
    /// imagery — the placeholder stays on-brand and never leaks
    /// "broken image" feel.
    private var artwork: some View {
        ZStack {
            if let url = coverURL {
                CachedAsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    placeholderArt
                }
            } else {
                placeholderArt
            }
        }
    }

    private var coverURL: URL? {
        if let first = venue.photo_urls?.first, let u = URL(string: first) { return u }
        if let single = venue.photo_url, let u = URL(string: single) { return u }
        return nil
    }

    private var placeholderArt: some View {
        ZStack {
            DSColor.surfaceElevated
            CourtMini()
                .stroke(DSColor.textTertiary.opacity(0.32), lineWidth: 1)
                .padding(20)
            Image(systemName: "sportscourt")
                .font(.system(size: 28, weight: .regular))
                .foregroundStyle(DSColor.accent.opacity(0.55))
        }
    }

    private var distanceLabel: String {
        if let km = venue.distance_km {
            return DistanceFormatter.km(km)
        }
        return "—"
    }
}

private struct CourtMini: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.addRect(rect)
        p.move(to: CGPoint(x: rect.minX, y: rect.midY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        p.move(to: CGPoint(x: rect.midX, y: rect.minY + rect.height * 0.3))
        p.addLine(to: CGPoint(x: rect.midX, y: rect.minY + rect.height * 0.7))
        return p
    }
}
