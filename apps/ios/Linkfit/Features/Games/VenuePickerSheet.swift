import SwiftUI

/// Sheet-style venue picker used by the Create-Game flow. Shows the
/// list of padel venues with name + address + distance, plus a "no
/// specific venue" affordance for hosts who just want to broadcast a
/// general location.
///
/// Why this exists: previously the Create-Game form had nowhere to
/// pick a venue, even though the viewmodel was loading venues and
/// supported `selectedVenue`. Hosts ended up creating games with the
/// generic "Venue TBD" placeholder visible on the matches feed —
/// exactly the breakage the user reported.
struct VenuePickerSheet: View {
    let venues: [Venue]
    let selectedId: String?
    var onSelect: (Venue) -> Void
    var onClear: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        NavigationStack {
            ZStack {
                AppGlassBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        searchField
                        clearSelectionRow
                        Divider().overlay(DSColor.border.opacity(0.4))
                        venueList
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 40)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .navigationTitle(Text("create_game.venue.picker.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        UISelectionFeedbackGenerator().selectionChanged()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .fontWeight(.semibold)
                            .foregroundStyle(DSColor.textPrimary)
                    }
                    .accessibilityLabel(Text("common.close"))
                }
            }
        }
    }

    // MARK: - Subviews

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(DSColor.textTertiary)
            TextField(
                String(localized: "create_game.venue.search.placeholder"),
                text: $query
            )
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(DSColor.textPrimary)
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(DSColor.textTertiary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1)
        )
    }

    /// Always-visible row at the top of the list: "Don't pin to a
    /// venue". This is the canonical pattern for "optional foreign
    /// key" in mobile forms — show the clear-affordance as a regular
    /// row, not a separate gesture.
    private var clearSelectionRow: some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            onClear()
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(DSColor.surfaceElevated.opacity(0.6))
                        .frame(width: 38, height: 38)
                    Image(systemName: "location.slash")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(DSColor.textSecondary)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("create_game.venue.none.title")
                        .font(DSType.cardTitle)
                        .foregroundStyle(DSColor.textPrimary)
                    Text("create_game.venue.none.subtitle")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(DSColor.textSecondary)
                        .lineLimit(2)
                }
                Spacer()
                if selectedId == nil {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(DSColor.accent)
                }
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(.ultraThinMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(
                        selectedId == nil ? DSColor.accent.opacity(0.5) : DSColor.border.opacity(0.4),
                        lineWidth: selectedId == nil ? 1.5 : 1
                    )
            )
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var venueList: some View {
        if filtered.isEmpty {
            emptyState
        } else {
            VStack(spacing: 10) {
                ForEach(filtered) { venue in
                    venueRow(venue)
                }
            }
        }
    }

    private func venueRow(_ venue: Venue) -> some View {
        let isSelected = venue.id == selectedId
        return Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            onSelect(venue)
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(DSColor.accent.opacity(0.16))
                        .frame(width: 38, height: 38)
                    Image(systemName: venue.is_partner ? "checkmark.seal.fill" : "mappin.and.ellipse")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(DSColor.accent)
                }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(venue.name)
                            .font(DSType.cardTitle)
                            .foregroundStyle(DSColor.textPrimary)
                            .lineLimit(1)
                        if venue.is_partner {
                            Text("create_game.venue.partner_badge")
                                .font(DSType.badge)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .foregroundStyle(DSColor.accent)
                                .background(
                                    Capsule().fill(DSColor.accent.opacity(0.14))
                                )
                        }
                    }
                    Text(venue.address)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(DSColor.textSecondary)
                        .lineLimit(1)
                }
                Spacer()
                if let km = venue.distance_km {
                    Text(DistanceFormatter.km(km))
                        .font(DSType.badge)
                        .foregroundStyle(DSColor.textTertiary)
                        .monospacedDigit()
                }
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(DSColor.accent)
                }
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(.ultraThinMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(
                        isSelected ? DSColor.accent.opacity(0.5) : DSColor.border.opacity(0.4),
                        lineWidth: isSelected ? 1.5 : 1
                    )
            )
        }
        .buttonStyle(.plain)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "mappin.slash")
                .font(.system(size: 28))
                .foregroundStyle(DSColor.textTertiary)
            Text("create_game.venue.empty.title")
                .font(.system(size: 14, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
            Text(query.isEmpty
                 ? "create_game.venue.empty.body"
                 : "create_game.venue.empty.search_body")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    // MARK: - Filter

    private var filtered: [Venue] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else { return venues }
        return venues.filter { v in
            v.name.lowercased().contains(trimmed)
                || v.address.lowercased().contains(trimmed)
        }
    }
}
