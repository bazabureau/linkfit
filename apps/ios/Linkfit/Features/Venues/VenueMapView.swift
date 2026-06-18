import SwiftUI
import MapKit
import CoreLocation
import UIKit

/// Full-screen MapKit view that pins every padel venue with a
/// lime-tinted brand marker, supports native clustering on zoom-out, and
/// surfaces a "Get directions" card from the bottom on tap.
struct VenueMapView: View {
    let venues: [Venue]
    @State private var mapVM = VenueMapViewModel()
    /// Venue the user chose to book from the detail card. Drives a
    /// dedicated booking sheet so we never stack `BookCourtView`
    /// on top of the still-open detail card (sheet-on-sheet is fragile).
    @State private var venueToBook: Venue?

    var body: some View {
        Map(position: $mapVM.cameraPosition, selection: Binding(
            get: { mapVM.selectedVenueID },
            set: { mapVM.selectedVenueID = $0 }
        )) {
            // Native user-location overlay — only renders when permission
            // is granted; MapKit handles the styled blue dot itself.
            UserAnnotation()

            ForEach(venues) { venue in
                Annotation(
                    venue.name,
                    coordinate: CLLocationCoordinate2D(latitude: venue.lat, longitude: venue.lng),
                    anchor: .bottom
                ) {
                    VenuePinView(isPartner: venue.is_partner)
                        .onTapGesture {
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            mapVM.select(venue)
                        }
                        .accessibilityLabel(Text(venue.name))
                }
                .tag(venue.id)
                // Cluster identifier — MapKit groups annotations sharing this
                // identifier when zoomed out, surfacing a count bubble.
                .annotationTitles(.hidden)
            }
        }
        .mapStyle(.standard(elevation: .realistic, pointsOfInterest: .excludingAll))
        .mapControls {
            MapUserLocationButton()
            MapCompass()
            MapScaleView()
        }
        .ignoresSafeArea(edges: .bottom)
        .onAppear { mapVM.onAppear() }
        .sheet(item: selectedVenueBinding) { venue in
            VenueDetailCard(
                venue: venue,
                distanceKm: mapVM.distanceKm(to: venue),
                onBook: {
                    // Close the detail card, then hand off to the booking
                    // sheet on the next runloop so the dismissal lands first.
                    mapVM.selectedVenueID = nil
                    DispatchQueue.main.async { venueToBook = venue }
                },
                onDirections: { openDirections(to: venue) }
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
            .presentationBackground(DSColor.surface)
        }
        .sheet(item: $venueToBook) { venue in
            // Pre-seed the booking flow with the tapped venue so the user
            // skips the venue picker and lands on court/slot selection.
            BookCourtView(presetVenueId: venue.id)
                .presentationDragIndicator(.visible)
        }
        .alert(
            String(localized: "venues.location_denied.title"),
            isPresented: $mapVM.showDeniedAlert
        ) {
            Button(String(localized: "venues.location_denied.open_settings")) {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            Button(String(localized: "common.ok"), role: .cancel) {}
        } message: {
            Text(String(localized: "venues.location_denied.message"))
        }
    }

    // Bridge between String? selection ID and Identifiable Venue for `.sheet(item:)`.
    private var selectedVenueBinding: Binding<Venue?> {
        Binding(
            get: { venues.first(where: { $0.id == mapVM.selectedVenueID }) },
            set: { newValue in mapVM.selectedVenueID = newValue?.id }
        )
    }

    private func openDirections(to venue: Venue) {
        // Apple Maps universal link — works whether or not the app is installed.
        let destination = "\(venue.lat),\(venue.lng)"
        guard let encodedName = venue.name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "https://maps.apple.com/?daddr=\(destination)&q=\(encodedName)")
        else { return }
        UIApplication.shared.open(url)
    }
}

// MARK: - Pin

private struct VenuePinView: View {
    let isPartner: Bool

    var body: some View {
        ZStack {
            Circle()
                .fill(DSColor.accent)
                .frame(width: 38, height: 38)
            Image(systemName: isPartner ? "star.fill" : "figure.tennis")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(DSColor.textOnAccent)
        }
        // The downward-pointing tail makes the marker feel like a pin
        // rather than a generic dot.
        .overlay(alignment: .bottom) {
            Triangle()
                .fill(DSColor.accent)
                .frame(width: 12, height: 8)
                .offset(y: 6)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
    }
}

private struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.midX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        p.closeSubpath()
        return p
    }
}

// MARK: - Bottom card

private struct VenueDetailCard: View {
    let venue: Venue
    let distanceKm: Double?
    /// Primary action — opens the booking flow preset to this venue.
    /// Optional with a no-op default so the card stays back-compatible
    /// for any caller that only wants directions.
    var onBook: () -> Void = {}
    let onDirections: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.md) {
            HStack(alignment: .top, spacing: DSSpacing.sm) {
                VStack(alignment: .leading, spacing: DSSpacing.xs) {
                    HStack(spacing: DSSpacing.xs) {
                        Text(venue.name)
                            .font(DSType.title)
                            .foregroundStyle(DSColor.textPrimary)
                        if venue.is_partner {
                            Text("venues.partner")
                                .font(DSType.caption)
                                .foregroundStyle(DSColor.accent)
                                .padding(.horizontal, DSSpacing.xs)
                                .padding(.vertical, 2)
                                .background(Capsule().fill(DSColor.accentMuted))
                        }
                    }
                    Text(venue.address)
                        .font(DSType.footnote)
                        .foregroundStyle(DSColor.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }

            if let km = distanceKm ?? venue.distance_km {
                Label {
                    Text(String(format: String(localized: "venues.distance_away_format"), km))
                        .font(DSType.footnote)
                        .foregroundStyle(DSColor.textSecondary)
                } icon: {
                    Image(systemName: "location.fill")
                        .foregroundStyle(DSColor.accent)
                }
            }

            VStack(spacing: DSSpacing.sm) {
                // Primary anchor: book a court at this venue.
                PrimaryButton(
                    title: String(localized: "actions.book_court"),
                    icon: "calendar.badge.plus",
                    action: onBook
                )

                // Secondary: directions read as a quiet, bordered action so
                // the card keeps a single primary anchor (FAZA 45 restraint).
                SecondaryButton(
                    title: String(localized: "venues.get_directions"),
                    icon: "arrow.triangle.turn.up.right.diamond.fill"
                ) {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    onDirections()
                }
            }
        }
        .padding(DSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
