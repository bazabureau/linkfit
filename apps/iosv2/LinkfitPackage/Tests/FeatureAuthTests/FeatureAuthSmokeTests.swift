import Testing
@testable import FeatureAuth

@Suite struct FeatureAuthSmokeTests {
    @Test func moduleLinks() {
        #expect(FeatureAuth.isReady)
    }
}
