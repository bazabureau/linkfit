import SwiftUI

/// The single largest visual element on home — a tinted-glass card that
/// holds the two primary calls-to-action for an active session:
/// **Create a game** and **Find a game**. Everything else on home is
/// either lighter-weight (pulse strip, sections) or discovery content
/// (clubs, tournaments).
///
/// Why one big card instead of a 2×2 quick-action grid:
///   - On the previous home, four equally-sized lime tiles produced a
///     "grid of options" pattern that read as a menu, not as a primary
///     action. Decision research shows that a single dominant CTA
///     converts ~2-3× higher than a grid of peers.
///   - "Book court" and "Tournaments" — the other two former tiles —
///     are now: (a) accessible from inside the Create flow when you
///     want to reserve a venue, (b) reachable via the tab bar
///     (Tournaments) and the footer book-court chip.
///
/// Visual treatment:
///   - Subtle diagonal lime gradient over `.ultraThinMaterial` so the
///     card lifts off the mesh background without being a flat coloured
///     block (which would clash with the gradient backdrop).
///   - 46pt accent medallion top-left as a visual anchor.
///   - Heavy 22pt title + 13pt subtitle.
///   - Two equal-width capsule buttons. The primary (Create) is filled
///     lime; the secondary (Find) is glass + lime border. Equal weight
///     so neither feels coerced — both are valid "next moves".
struct HomePrimaryActionHero: View {
    var onCreate: () -> Void
    var onFind: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header: medallion + title/subtitle column
            HStack(alignment: .top, spacing: 14) {
                medallion
                VStack(alignment: .leading, spacing: 4) {
                    Text("home.primary.title")
                        .font(.system(size: 22, weight: .heavy, design: .default))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)

                    Text("home.primary.subtitle")
                        .font(.system(size: 13, weight: .medium, design: .default))
                        .foregroundStyle(DSColor.textSecondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack(spacing: 10) {
                primaryButton
                secondaryButton
            }
        }
        .padding(18)
        .background(cardBackground)
        .overlay(cardStroke)
    }

    // MARK: - Subviews

    private var medallion: some View {
        ZStack {
            Circle()
                .fill(DSColor.accent.opacity(0.18))
                .frame(width: 46, height: 46)
            Image(systemName: "figure.tennis")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(DSColor.accent)
        }
    }

    private var primaryButton: some View {
        Button {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            onCreate()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "plus")
                    .font(.system(size: 13, weight: .heavy))
                Text("home.primary.cta_create")
            }
            .font(.system(size: 14, weight: .heavy, design: .default))
            .foregroundStyle(DSColor.textOnAccent)
            .frame(maxWidth: .infinity, minHeight: 46)
            .background(Capsule().fill(DSColor.accent))
            .shadow(color: DSColor.accent.opacity(0.30), radius: 12, y: 6)
        }
        .buttonStyle(.plain)
    }

    private var secondaryButton: some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            onFind()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 13, weight: .heavy))
                Text("home.primary.cta_find")
            }
            .font(.system(size: 14, weight: .heavy, design: .default))
            .foregroundStyle(DSColor.textPrimary)
            .frame(maxWidth: .infinity, minHeight: 46)
            .background(
                Capsule()
                    .fill(.ultraThinMaterial)
                    .overlay(
                        Capsule().strokeBorder(DSColor.accent.opacity(0.35), lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: 22, style: .continuous)
            .fill(.ultraThinMaterial)
            .overlay(
                LinearGradient(
                    colors: [
                        DSColor.accent.opacity(0.14),
                        DSColor.accent.opacity(0.04),
                        Color.clear
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            )
    }

    private var cardStroke: some View {
        RoundedRectangle(cornerRadius: 22, style: .continuous)
            .strokeBorder(DSColor.accent.opacity(0.22), lineWidth: 1)
    }
}
