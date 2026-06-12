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
                onDirections: { openDirections(to: venue) }
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
            .presentationBackground(DSColor.surface)
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
                .shadow(color: DSColor.accent.opacity(0.45), radius: 10, x: 0, y: 4)
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

            PrimaryButton(
                title: String(localized: "venues.get_directions"),
                icon: "arrow.triangle.turn.up.right.diamond.fill",
                action: onDirections
            )
        }
        .padding(DSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
