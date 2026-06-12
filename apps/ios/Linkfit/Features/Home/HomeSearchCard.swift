import SwiftUI

/// Layered search card that overlaps the hero by ~32pt. Three pill rows
/// (location, date, sport) and the primary lime CTA. Matches the booking-app
/// reference's white card on green photo.
struct HomeSearchCard: View {
    @Binding var locationLabel: String
    @Binding var dateLabel: String
    @Binding var sportLabel: String
    var onTapLocation: () -> Void
    var onTapDate: () -> Void
    var onTapSport: () -> Void
    var onSubmit: () -> Void

    var body: some View {
        VStack(spacing: DSSpacing.sm) {
            pillRow(icon: "location.fill", label: locationLabel, action: onTapLocation)
            pillRow(icon: "calendar", label: dateLabel, action: onTapDate)
            pillRow(icon: "sportscourt.fill", label: sportLabel, action: onTapSport)

            Button(action: onSubmit) {
                HStack(spacing: DSSpacing.xs) {
                    Text("home.find_game")
                        .font(.system(.body, design: .rounded, weight: .semibold))
                        .foregroundStyle(DSColor.limeInk)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(DSColor.limeInk)
                }
                .frame(maxWidth: .infinity, minHeight: 54)
                .background(
                    Capsule().fill(DSColor.lime)
                )
            }
            .buttonStyle(.plain)
            .padding(.top, DSSpacing.xxs)
            .accessibilityLabel(Text("home.find_a_game"))
        }
        .padding(DSSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(DSColor.surface)
                .shadow(color: .black.opacity(0.12), radius: 24, x: 0, y: 14)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.6), lineWidth: 1)
        )
    }

    private func pillRow(icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: DSSpacing.sm) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
                    .frame(width: 28)
                Text(label)
                    .font(.system(.subheadline, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DSColor.textSecondary)
            }
            .padding(.horizontal, DSSpacing.md)
            .frame(height: 50)
            .background(
                Capsule().fill(DSColor.surfaceElevated)
            )
            .overlay(
                Capsule().strokeBorder(DSColor.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}
