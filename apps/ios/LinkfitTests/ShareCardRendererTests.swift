import XCTest
@testable import Linkfit

final class ShareCardRendererTests: XCTestCase {

    /// Smoke test: rasterising the preview fixture should produce a non-trivial
    /// PNG. We don't pixel-compare — `ImageRenderer` is a moving target across
    /// iOS versions — but we *do* require:
    ///  - A valid PNG signature at the head of the byte stream.
    ///  - At least ~1 KB of payload — far below what a single solid colour
    ///    fill would produce, so any regression that drops the layout to
    ///    nothing will trip this assertion.
    func testRenderProducesValidPNGOverOneKilobyte() async throws {
        let data = try await ShareCardRenderer.shared.renderPNG(
            data: .preview,
            variant: .square
        )

        XCTAssertGreaterThan(data.count, 1024,
                             "Rendered card PNG should be >1 KB; got \(data.count) bytes")

        // Standard PNG magic — first eight bytes.
        let pngMagic: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
        let head = Array(data.prefix(8))
        XCTAssertEqual(head, pngMagic,
                       "Output must start with the PNG magic signature")
    }

    func testStoryVariantWritesTempFile() async throws {
        let url = try await ShareCardRenderer.shared.writeTemporaryPNG(
            data: .preview,
            variant: .story
        )
        defer { try? FileManager.default.removeItem(at: url) }

        let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
        let size = (attrs[.size] as? Int) ?? 0
        XCTAssertGreaterThan(size, 1024,
                             "Temp story PNG should exceed 1 KB; got \(size) bytes")
        XCTAssertEqual(url.pathExtension, "png")
        XCTAssertTrue(url.path.contains(NSTemporaryDirectory()),
                      "Generated file should live under NSTemporaryDirectory")
    }

    func testHookMapsScoresToWinOutcome() {
        let data = ShareCardHook.makeData(
            selfTeamScore: 6,
            opponentScore: 4,
            selfTeamPlayers: [("me", "Me", nil)],
            opponentPlayers: [("them", "Them", nil)],
            currentUserId: "me",
            sportLabel: "Padel",
            venueName: "Arena",
            date: Date(timeIntervalSince1970: 0),
            eloChange: 18,
            shareURL: nil
        )
        XCTAssertEqual(data.outcome, .win)
        XCTAssertEqual(data.selfTeam.first?.isSelf, true)
        XCTAssertEqual(data.sportAndVenue, "Padel · Arena")
    }

    // MARK: - Wave-10 cards

    /// Joined-card builder must place the host first, the signed-in
    /// user second, and tag both correctly. We rely on the deterministic
    /// `isHost`/`isSelf` flags downstream so the slot grid lights up
    /// the right chip.
    func testJoinedHookOrdersAndTagsPlayers() {
        let data = ShareCardHook.makeJoinedData(
            participants: [
                (id: "p3", displayName: "Other A", avatarURL: nil),
                (id: "host", displayName: "Host H", avatarURL: nil),
                (id: "me", displayName: "Me", avatarURL: nil),
                (id: "p4", displayName: "Other B", avatarURL: nil)
            ],
            capacity: 4,
            hostUserId: "host",
            currentUserId: "me",
            sportLabel: "Padel",
            venueName: "Arena",
            startsAt: Date(timeIntervalSince1970: 0),
            referralCode: "KMRN12",
            shareURL: URL(string: "https://linkfit.az/g/abc")
        )
        XCTAssertEqual(data.filledSlots.count, 4)
        XCTAssertEqual(data.filledSlots.first?.id, "host")
        XCTAssertEqual(data.filledSlots.first?.isHost, true)
        // Me sits in slot 1 — the prominent top-right of the 2×2 grid.
        XCTAssertEqual(data.filledSlots[1].id, "me")
        XCTAssertEqual(data.filledSlots[1].isSelf, true)
        XCTAssertEqual(data.referralCode, "KMRN12")
        XCTAssertEqual(data.capacity, 4)
    }

    /// MilestoneCard skill-level bucket must map straight from the ELO
    /// integer via `SkillLevel.from(elo:)`. Picking 1500 puts us in
    /// `.advanced`; previous 1250 was `.intermediate` so the from→to
    /// arrow should fire.
    func testMilestoneHookMapsEloToBucket() {
        let data = ShareCardHook.makeMilestoneData(
            currentElo: 1500,
            previousElo: 1250,
            displayName: "Kamran",
            gamesPlayed: 12,
            referralCode: nil,
            shareURL: nil
        )
        XCTAssertEqual(data.currentLevel, .advanced)
        XCTAssertEqual(data.previousLevel, .intermediate)
        XCTAssertEqual(data.gamesPlayed, 12)
    }

    /// When current and previous ELO map to the same bucket (e.g. a
    /// micro-bump within `.intermediate`), the card must collapse the
    /// previousLevel to nil so we don't render a from→to arrow that
    /// shows the same chip twice.
    func testMilestoneCollapsesSameBucket() {
        let data = ShareCardHook.makeMilestoneData(
            currentElo: 1290,
            previousElo: 1200,
            displayName: "Kamran",
            gamesPlayed: 5,
            referralCode: nil,
            shareURL: nil
        )
        XCTAssertEqual(data.currentLevel, .intermediate)
        XCTAssertNil(data.previousLevel)
    }

    func testJoinedCardWritesTempFile() async throws {
        let url = try await ShareCardRenderer.shared.writeJoinedCard(.preview)
        defer { try? FileManager.default.removeItem(at: url) }
        let size = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
        XCTAssertGreaterThan(size, 1024)
        XCTAssertEqual(url.pathExtension, "png")
    }

    func testMilestoneCardWritesTempFile() async throws {
        let url = try await ShareCardRenderer.shared.writeMilestoneCard(.preview)
        defer { try? FileManager.default.removeItem(at: url) }
        let size = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
        XCTAssertGreaterThan(size, 1024)
        XCTAssertEqual(url.pathExtension, "png")
    }
}
