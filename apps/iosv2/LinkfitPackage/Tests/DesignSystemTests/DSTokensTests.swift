import Testing
@testable import DesignSystem

@Suite struct DSTokensTests {
    @Test func radiiMatchSpec() {
        #expect(DSRadius.card == 20)
        #expect(DSRadius.button == 16)
        #expect(DSRadius.sheet == 26)
    }

    @Test func spacingScaleIsMonotonic() {
        #expect(DSSpacing.xs < DSSpacing.m)
        #expect(DSSpacing.m < DSSpacing.xl)
        #expect(DSSpacing.page == 20)
    }
}
