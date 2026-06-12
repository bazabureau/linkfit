import XCTest
@testable import Linkfit

/// Pure-logic tests for the post-game rating flow. The view model is the
/// only place where outcome capture happens before the network round-trip,
/// so its progress / completion / index advancement contract has to stay
/// rock-solid as the UI gets reshuffled.
@MainActor
final class RatingFlowViewModelTests: XCTestCase {

    // MARK: - Test doubles

    /// Stub APIClient — every `send` succeeds and records the call. The
    /// upload path is unused by the rating flow so we throw if anyone tries.
    private final class StubAPIClient: APIClient, @unchecked Sendable {
        var sendCalls = 0
        var shouldFail = false

        func send<R: Decodable>(_ endpoint: Endpoint<R>) async throws -> R {
            sendCalls += 1
            if shouldFail {
                throw APIError.server(status: 500, code: "BOOM", message: "stub failure")
            }
            // The only endpoint the flow hits is `.submitRatings`, whose
            // Response is `SubmitRatingsResponse`. Decode a synthesised JSON
            // payload so the test doesn't depend on the exact shape.
            let json = #"{"recorded":1,"skipped_duplicates":0}"#.data(using: .utf8)!
            let decoder = JSONDecoder()
            return try decoder.decode(R.self, from: json)
        }

        func uploadImage(imageData: Data, mimeType: String, filename: String) async throws -> UploadImageResponse {
            XCTFail("uploadImage should not be called by the rating flow")
            throw APIError.unknown(message: "unreachable")
        }
    }

    // MARK: - Fixtures

    private func makePlayer(_ id: String) -> Participant {
        Participant(
            user_id: id,
            display_name: "P-\(id)",
            photo_url: nil,
            status: .confirmed,
            joined_at: "2026-05-18T12:00:00Z"
        )
    }

    // MARK: - Tests

    func test_progress_isZero_atStart() {
        let vm = RatingFlowViewModel(
            apiClient: StubAPIClient(),
            gameId: "g1",
            coplayers: [makePlayer("a"), makePlayer("b"), makePlayer("c")]
        )
        XCTAssertEqual(vm.progress, 0, accuracy: 0.0001)
        XCTAssertFalse(vm.isComplete)
    }

    func test_progress_isOne_whenNoCoplayers() {
        // Edge case: a 1-on-1 game where the host has nobody to rate. The
        // flow must short-circuit to "done" so the UI can skip the screen.
        let vm = RatingFlowViewModel(apiClient: StubAPIClient(), gameId: "g1", coplayers: [])
        XCTAssertEqual(vm.progress, 1, accuracy: 0.0001)
        XCTAssertFalse(vm.isComplete)
        XCTAssertNil(vm.currentPlayer)
    }

    func test_record_advancesIndex_andTracksRating() {
        let players = [makePlayer("a"), makePlayer("b"), makePlayer("c")]
        let vm = RatingFlowViewModel(apiClient: StubAPIClient(), gameId: "g1", coplayers: players)

        // Set values for first co-player
        vm.setOutcome("won")
        vm.setStars(5)
        
        let draftA = vm.draft(for: "a")
        XCTAssertEqual(draftA.outcome, "won")
        XCTAssertEqual(draftA.stars, 5)
        
        vm.goNext()
        XCTAssertEqual(vm.index, 1, "goNext should advance to next player index.")

        // Set values for second co-player
        vm.setOutcome("lost")
        vm.setStars(3)
        
        let draftB = vm.draft(for: "b")
        XCTAssertEqual(draftB.outcome, "lost")
        XCTAssertEqual(draftB.stars, 3)
    }

    func test_record_holdsIndex_onLastPlayer_andMarksComplete() {
        let players = [makePlayer("a"), makePlayer("b")]
        let vm = RatingFlowViewModel(apiClient: StubAPIClient(), gameId: "g1", coplayers: players)

        // Draft A
        vm.setOutcome("won")
        vm.setStars(5)
        vm.goNext() // index: 0 -> 1

        // Draft B
        vm.setOutcome("lost")
        vm.setStars(4)
        vm.goNext() // index stays at 1 (last)

        XCTAssertEqual(vm.index, 1, "Index must not run past the last player.")
        XCTAssertTrue(vm.isComplete, "isComplete reflects that all drafts are finished.")
    }

    func test_recordOverwritesPreviousRating_forSamePlayer() {
        // Calling setOutcome twice for the same player must overwrite the previous value
        let players = [makePlayer("a")]
        let vm = RatingFlowViewModel(apiClient: StubAPIClient(), gameId: "g1", coplayers: players)

        vm.setOutcome("won")
        XCTAssertEqual(vm.draft(for: "a").outcome, "won")

        vm.setOutcome("lost")
        XCTAssertEqual(vm.draft(for: "a").outcome, "lost")
    }

    func test_submit_returnsTrue_andClearsError_onSuccess() async {
        let stub = StubAPIClient()
        let players = [makePlayer("a")]
        let vm = RatingFlowViewModel(apiClient: stub, gameId: "g1", coplayers: players)
        
        vm.setOutcome("won")
        vm.setStars(5)
        vm.error = "previous"

        let ok = await vm.submit()
        XCTAssertTrue(ok)
        XCTAssertNil(vm.error)
        XCTAssertEqual(stub.sendCalls, 1)
        XCTAssertFalse(vm.isSubmitting, "isSubmitting must reset via defer block.")
    }

    func test_submit_returnsFalse_andSetsError_onAPIFailure() async {
        let stub = StubAPIClient()
        stub.shouldFail = true
        let players = [makePlayer("a")]
        let vm = RatingFlowViewModel(apiClient: stub, gameId: "g1", coplayers: players)
        
        vm.setOutcome("won")
        vm.setStars(4)

        let ok = await vm.submit()
        XCTAssertFalse(ok)
        XCTAssertNotNil(vm.error, "API failures must surface a user-visible error.")
        XCTAssertFalse(vm.isSubmitting)
    }
}
