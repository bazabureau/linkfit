import Testing
import Foundation
@testable import AppCore

@Suite struct EnvConfigTests {
    @Test func fallsBackToProductionBaseURLWhenKeyAbsent() {
        // The test bundle has no API_BASE_URL key, so load() must use the default.
        let env = EnvConfig.load(bundle: .main)
        #expect(env.apiBaseURL == EnvConfig.defaultBaseURL)
        #expect(env.apiBaseURL.absoluteString == "https://api.linkfit.az")
    }

    @Test func hasNoPinsByDefault() {
        let env = EnvConfig.load(bundle: .main)
        #expect(env.certPins.isEmpty)
    }

    @Test func directInitRetainsValues() {
        let env = EnvConfig(
            apiBaseURL: URL(string: "https://example.com")!,
            certPins: ["pinA", "pinB"]
        )
        #expect(env.certPins == ["pinA", "pinB"])
        #expect(env.sentryDSN == nil)
    }
}
