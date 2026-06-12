import XCTest
import SwiftUI
@testable import Linkfit

final class DesignSystemTokensTests: XCTestCase {

    func testSpacingScaleIsStrictlyMonotonic() {
        let scale = DSSpacing.scale
        for i in 1..<scale.count {
            XCTAssertGreaterThan(scale[i], scale[i - 1],
                                 "Spacing scale must be strictly increasing at index \(i)")
        }
    }

    func testSpacingScaleStartsAtFourPoints() {
        XCTAssertEqual(DSSpacing.scale.first, 4,
                       "Base unit should be 4pt to honour Apple's 8-pt grid system.")
    }

    func testRadiusPillIsLargeEnoughForCapsule() {
        XCTAssertGreaterThanOrEqual(DSRadius.pill, 100,
                                    "Pill radius must be large enough to fully round any reasonable height.")
    }

    func testColorTokensResolveForLightAndDarkAppearance() {
        let light = UITraitCollection(userInterfaceStyle: .light)
        let dark = UITraitCollection(userInterfaceStyle: .dark)

        let lightBackground = UIColor(DSColor.background).resolvedColor(with: light)
        let lightSurface = UIColor(DSColor.surface).resolvedColor(with: light)
        let lightElevated = UIColor(DSColor.surfaceElevated).resolvedColor(with: light)
        let darkBackground = UIColor(DSColor.background).resolvedColor(with: dark)
        let darkSurface = UIColor(DSColor.surface).resolvedColor(with: dark)
        let darkElevated = UIColor(DSColor.surfaceElevated).resolvedColor(with: dark)

        XCTAssertGreaterThan(brightness(lightBackground), 0.90,
                             "Light mode should stay bright and readable.")
        XCTAssertGreaterThan(brightness(lightSurface), brightness(lightElevated),
                             "Light elevated controls should sit subtly inside white surfaces.")
        XCTAssertLessThan(brightness(darkBackground), 0.08,
                          "Dark mode background must remain near-black.")
        XCTAssertGreaterThan(brightness(darkSurface), brightness(darkBackground),
                             "Dark surface must be brighter than background.")
        XCTAssertGreaterThan(brightness(darkElevated), brightness(darkSurface),
                             "Dark elevated controls must be brighter than cards.")
    }

    func testAccentIsHighlyChromaticLime() {
        let resolved = UIColor(DSColor.accent).resolvedColor(with: UITraitCollection())
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        resolved.getRed(&r, green: &g, blue: &b, alpha: &a)
        XCTAssertGreaterThan(g, 0.7, "Accent green channel must be vivid.")
        XCTAssertGreaterThan(g, b + 0.3, "Accent must be dominantly green over blue.")
        XCTAssertLessThan(b, 0.5, "Accent blue channel must stay low (lime).")
    }

    private func brightness(_ c: UIColor) -> CGFloat {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        return (r + g + b) / 3
    }
}
