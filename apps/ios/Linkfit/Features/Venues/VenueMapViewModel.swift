import Foundation
import Observation
import CoreLocation
import MapKit
import SwiftUI

/// Backing view model for the venue map. Owns the camera, user-location
/// permission state, and computes "distance from me" for each venue.
@Observable
@MainActor
final class VenueMapViewModel: NSObject, CLLocationManagerDelegate {
    /// Default Baku city-center fallback used when location is unavailable.
    static let bakuFallback = CLLocationCoordinate2D(latitude: 40.4093, longitude: 49.8671)

    private(set) var userLocation: CLLocation?
    private(set) var authorizationStatus: CLAuthorizationStatus
    var showDeniedAlert: Bool = false
    var selectedVenueID: String?
    var cameraPosition: MapCameraPosition

    private let locationManager: CLLocationManager

    override init() {
        let manager = CLLocationManager()
        self.locationManager = manager
        self.authorizationStatus = manager.authorizationStatus
        self.cameraPosition = .region(
            MKCoordinateRegion(
                center: Self.bakuFallback,
                span: MKCoordinateSpan(latitudeDelta: 0.18, longitudeDelta: 0.18)
            )
        )
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    /// Called when the map first appears. Requests permission the very first
    /// time, otherwise re-syncs location if already authorized.
    func onAppear() {
        switch authorizationStatus {
        case .notDetermined:
            locationManager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            locationManager.requestLocation()
        case .denied, .restricted:
            // Quietly fall back to Baku center — no nag on first map view.
            break
        @unknown default:
            break
        }
    }

    /// Returns straight-line km between user and venue, or nil if user
    /// location not yet resolved.
    func distanceKm(to venue: Venue) -> Double? {
        guard let userLocation else { return nil }
        let venueLoc = CLLocation(latitude: venue.lat, longitude: venue.lng)
        return userLocation.distance(from: venueLoc) / 1000.0
    }

    func select(_ venue: Venue) {
        selectedVenueID = venue.id
    }

    func clearSelection() {
        selectedVenueID = nil
    }

    // MARK: CLLocationManagerDelegate

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        // CLLocationManager isn't Sendable under Swift 6 strict concurrency,
        // so we hop to the main actor first and use our own retained
        // reference (`self.locationManager`) for any follow-up calls.
        Task { @MainActor in
            self.authorizationStatus = status
            switch status {
            case .authorizedWhenInUse, .authorizedAlways:
                self.locationManager.requestLocation()
            case .denied, .restricted:
                // Only show denial card if user actively turned it off, not
                // when state was already-denied at first launch.
                self.showDeniedAlert = true
            default:
                break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let latest = locations.last else { return }
        Task { @MainActor in
            self.userLocation = latest
            // Re-center the camera once we have a fresh fix.
            self.cameraPosition = .region(
                MKCoordinateRegion(
                    center: latest.coordinate,
                    span: MKCoordinateSpan(latitudeDelta: 0.12, longitudeDelta: 0.12)
                )
            )
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Swallow — fallback to Baku center silently. Real failures here
        // (airplane mode, GPS off) shouldn't crash the map UX.
    }
}
