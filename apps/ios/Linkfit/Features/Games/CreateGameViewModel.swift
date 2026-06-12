import Foundation
import Observation
import CoreLocation

/// Drives the redesigned Create-Game flow. Single screen, every field has
/// a sensible default so the form is submittable in one tap once a sport
/// is chosen.
@Observable
@MainActor
final class CreateGameViewModel {

    // MARK: - Catalog

    private(set) var sports: [Sport] = []
    private(set) var venues: [Venue] = []

    // MARK: - Form state

    var selectedSport: Sport?
    var selectedVenue: Venue?           // nil = "custom / open location"
    var startsAt: Date = nextRoundedHour(plusHours: 2)
    var durationMinutes: Int = 90
    var capacity: Int = 4
    var skillBand: SkillBand = .any
    var visibility: Visibility = .public
    var notes: String = ""

    // MARK: - UI state

    var formError: String?
    var isSubmitting = false

    private let apiClient: APIClient

    /// Three "when do you want to play?" presets — computed once at
    /// init and held stable for the life of the view model. The dates
    /// only stale across midnight, an acceptable trade for a sheet that
    /// stays open well under five minutes; recomputing on every body
    /// pass of CreateGameView was reallocating a `Calendar` plus four
    /// derived `Date`s per render.
    let quickStarts: [QuickStart]

    init(apiClient: APIClient) {
        self.apiClient = apiClient
        self.quickStarts = Self.makeQuickStarts(now: Date())
    }

    enum SkillBand: String, CaseIterable, Identifiable, Hashable {
        case any, beginner, intermediate, advanced

        var id: String { rawValue }
        var titleKey: String.LocalizationValue {
            switch self {
            case .any:          return "create_game.skill.any"
            case .beginner:     return "create_game.skill.beginner"
            case .intermediate: return "create_game.skill.intermediate"
            case .advanced:     return "create_game.skill.advanced"
            }
        }
        var range: (min: Int, max: Int)? {
            switch self {
            case .any:          return nil
            case .beginner:     return (800, 1199)
            case .intermediate: return (1200, 1499)
            case .advanced:     return (1500, 3000)
            }
        }
    }

    enum Visibility: String, CaseIterable, Identifiable, Hashable {
        case `public`, invite
        var id: String { rawValue }
        var titleKey: String.LocalizationValue {
            self == .public ? "create_game.visibility.public" : "create_game.visibility.invite"
        }
        var subtitleKey: String.LocalizationValue {
            self == .public ? "create_game.visibility.public.sub" : "create_game.visibility.invite.sub"
        }
        var icon: String {
            self == .public ? "globe.americas.fill" : "lock.fill"
        }
    }

    // MARK: - Lifecycle

    func onAppear() async {
        // Load sports + venues in parallel — both are catalog calls.
        async let sportsTask: Void = loadSports()
        async let venuesTask: Void = loadVenues()
        _ = await (sportsTask, venuesTask)
    }

    private func loadSports() async {
        do {
            sports = try await apiClient.send(.sports).items
                .filter { $0.slug != "football_5" && $0.slug != "football" }
            // Initialise the sport + capacity ONCE, on first load.
            // Subsequent calls to `loadSports` (catalog refresh, retry
            // after network blip) must not stomp the user's chosen
            // capacity — that was the bug behind "stepper jumps back
            // to 6 after I tap minus".
            if selectedSport == nil {
                let sport = sports.first(where: { $0.slug == "padel" }) ?? sports.first
                selectedSport = sport
                if let sport {
                    capacity = Self.defaultCapacity(for: sport)
                }
            }
        } catch {
            sports = []
        }
    }

    /// Canonical starting capacity for a sport. For padel this is 4 —
    /// the standard doubles match — not `max_players` (which is now 6
    /// to allow rotation/substitute games). Picking the midpoint as
    /// default would land on 4 anyway, but we hardcode for clarity.
    private static func defaultCapacity(for sport: Sport) -> Int {
        if sport.slug == "padel" { return 4 }
        return (sport.min_players + sport.max_players) / 2
    }

    private func loadVenues() async {
        do {
            venues = try await apiClient.send(Endpoint<ItemsResponse<Venue>>.venues(sport: "padel")).items
        } catch {
            venues = []
        }
    }

    // MARK: - Actions

    func selectSport(_ sport: Sport) {
        selectedSport = sport
        // Preserve the user's chosen capacity across sport changes
        // when it still falls inside the new sport's range. Only snap
        // to the sport's default when the current value would be
        // outright invalid for the new sport.
        if capacity < sport.min_players || capacity > sport.max_players {
            capacity = Self.defaultCapacity(for: sport)
        }
    }

    func selectVenue(_ venue: Venue?) {
        selectedVenue = venue
        if let v = venue {
            // Seed lat/lng from the venue so games without a specific court
            // still show up on the discover map at the right pin.
            // We don't expose a separate `coordinate` field anymore — the
            // server reads it from the venue at submit time.
            _ = v
        }
    }

    /// Snap startsAt to a quick-pick anchor (tonight, tomorrow PM, saturday).
    func setStartsAt(_ value: Date) { startsAt = value }

    func setDuration(_ minutes: Int) { durationMinutes = minutes }
    func setCapacity(_ value: Int) {
        let sport = selectedSport
        let min = sport?.min_players ?? 2
        let max = sport?.max_players ?? 12
        capacity = Swift.min(Swift.max(value, min), max)
    }

    func setSkillBand(_ value: SkillBand) { skillBand = value }
    func setVisibility(_ value: Visibility) { visibility = value }

    var canSubmit: Bool {
        guard let _ = selectedSport else { return false }
        guard startsAt > Date() else { return false }
        return !isSubmitting
    }

    /// Default coordinates when no venue is picked — viewer's home is used
    /// by the parent view, falling back to Baku centre. We don't store this
    /// in the view-model because Container access lives in the View layer.
    var fallbackCoordinate: CLLocationCoordinate2D {
        if let v = selectedVenue { return v.coordinate }
        return CLLocationCoordinate2D(latitude: 40.4093, longitude: 49.8671)
    }

    func submit(viewerHome: CLLocationCoordinate2D?) async -> GameDetail? {
        guard let sport = selectedSport else { return nil }
        formError = nil
        isSubmitting = true
        defer { isSubmitting = false }

        let coord = selectedVenue?.coordinate ?? viewerHome ?? fallbackCoordinate
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)

        let body = CreateGameBody(
            sport_id: sport.id,
            court_id: nil,
            lat: coord.latitude,
            lng: coord.longitude,
            // Symmetric with `Date.fromISO` on the read side — both
            // ends of the contract now agree on the fractional-seconds
            // ISO 8601 shape the backend ships.
            starts_at: startsAt.toISO(),
            duration_minutes: durationMinutes,
            capacity: capacity,
            skill_min_elo: skillBand.range?.min,
            skill_max_elo: skillBand.range?.max,
            notes: trimmedNotes.isEmpty ? nil : trimmedNotes
        )
        do {
            return try await apiClient.send(.createGame(body))
        } catch let error as APIError {
            formError = error.errorDescription ?? String(localized: "create_game.error.create")
            return nil
        } catch {
            formError = error.localizedDescription
            return nil
        }
    }

    // MARK: - Quick starts

    /// Three sensible "when do you want to play?" presets. Computed once
    /// per view-model lifetime in `init` — see the `quickStarts` stored
    /// property comment for the trade-off.
    private static func makeQuickStarts(now: Date) -> [QuickStart] {
        let cal = Calendar.current

        let tonight19 = cal.date(bySettingHour: 19, minute: 0, second: 0, of: now) ?? now
        let tonight = tonight19 > now.addingTimeInterval(60 * 30)
            ? tonight19
            : cal.date(byAdding: .day, value: 1, to: tonight19) ?? tonight19

        let tomorrow18: Date = {
            let base = cal.date(bySettingHour: 18, minute: 0, second: 0, of: now) ?? now
            return cal.date(byAdding: .day, value: 1, to: base) ?? base
        }()

        let saturday11 = nextWeekday(7, from: now, atHour: 11)

        return [
            QuickStart(key: "create_game.quickstart.tonight",     date: tonight),
            QuickStart(key: "create_game.quickstart.tomorrow_pm", date: tomorrow18),
            QuickStart(key: "create_game.quickstart.saturday",    date: saturday11),
        ]
    }

    struct QuickStart: Identifiable {
        let key: String.LocalizationValue
        let date: Date
        var id: TimeInterval { date.timeIntervalSince1970 }
    }

    private static func nextWeekday(_ weekday: Int, from date: Date, atHour hour: Int) -> Date {
        let cal = Calendar.current
        var comps = cal.dateComponents([.year, .month, .day], from: date)
        comps.hour = hour
        comps.minute = 0
        let base = cal.date(from: comps) ?? date
        let current = cal.component(.weekday, from: base)
        let diff = (weekday - current + 7) % 7
        return cal.date(byAdding: .day, value: diff == 0 ? 7 : diff, to: base) ?? base
    }
}

private func nextRoundedHour(plusHours: Int) -> Date {
    let cal = Calendar.current
    let now = Date().addingTimeInterval(TimeInterval(plusHours * 3600))
    var comps = cal.dateComponents([.year, .month, .day, .hour], from: now)
    comps.minute = 0
    comps.second = 0
    return cal.date(from: comps) ?? now
}

private extension Venue {
    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }
}
