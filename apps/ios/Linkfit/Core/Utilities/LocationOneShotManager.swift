import Foundation
import CoreLocation
import Combine

/// Single-shot location fetch wrapper around CLLocationManager.
///
/// Usage:
///   `manager.requestOnce { coord in ... }`
///
/// The manager handles the standard "not determined → request →
/// authorized → fetch" handshake, calls the completion exactly once,
/// then tears down its delegate references so it can be reused.
///
/// We use `ObservableObject` (not `@Observable`) because we need to
/// satisfy `CLLocationManagerDelegate`, which is `@objc` and can't be
/// adopted by an `@Observable` actor-isolated type. The published
/// `isAuthorized` property drives the button icon (filled location
/// glyph when the OS already granted permission).
@MainActor
final class LocationOneShotManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var isAuthorized: Bool = false

    private let manager = CLLocationManager()
    private var pending: ((CLLocationCoordinate2D?) -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        // Pre-seed the published auth flag so the UI doesn't flash
        // the unfilled glyph after the user has already granted us
        // permission in a previous session.
        let status = manager.authorizationStatus
        isAuthorized = status == .authorizedWhenInUse || status == .authorizedAlways
    }

    func requestOnce(_ completion: @escaping (CLLocationCoordinate2D?) -> Void) {
        pending = completion
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        case .denied, .restricted:
            finish(nil)
        @unknown default:
            finish(nil)
        }
    }

    // MARK: - CLLocationManagerDelegate

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            let status = self.manager.authorizationStatus
            self.isAuthorized = status == .authorizedWhenInUse || status == .authorizedAlways
            if (status == .authorizedWhenInUse || status == .authorizedAlways), self.pending != nil {
                self.manager.requestLocation()
            } else if status == .denied || status == .restricted {
                self.finish(nil)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in
            if let coord = locations.last?.coordinate {
                self.finish(coord)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.finish(nil)
        }
    }

    private func finish(_ coord: CLLocationCoordinate2D?) {
        let cb = pending
        pending = nil
        cb?(coord)
    }
}

/// Reverse-geocoding helper — converts a lat/lng into a friendly
/// "neighbourhood, city" string. Used to render the location pick
/// confirmation under the map without leaking raw coordinates to the
/// UI. CLGeocoder is rate-limited by Apple (~1 req/sec per process)
/// so we don't fire on every map drag — only on tap-commit.
final class AddressGeocoder: @unchecked Sendable {
    private let geocoder = CLGeocoder()

    func label(for lat: Double, lng: Double) async -> String {
        let location = CLLocation(latitude: lat, longitude: lng)
        do {
            let placemarks = try await geocoder.reverseGeocodeLocation(location)
            guard let p = placemarks.first else { return "" }
            // Prefer neighbourhood + city. Fall back to city alone, then
            // country. "Sublocality" is the human-readable district
            // (e.g. "Yasamal") rather than a thoroughfare or postcode.
            let parts: [String?] = [p.subLocality, p.locality ?? p.administrativeArea]
            return parts.compactMap { $0?.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
                .joined(separator: ", ")
        } catch {
            return ""
        }
    }
}
