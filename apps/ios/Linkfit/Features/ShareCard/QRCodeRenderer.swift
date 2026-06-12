import Foundation
#if canImport(CoreImage)
import CoreImage
import CoreImage.CIFilterBuiltins
#endif
#if canImport(UIKit)
import UIKit
#endif

/// Tiny CoreImage wrapper that turns a UTF-8 string into a crisp, scaled
/// `CGImage`. Kept outside `MatchResultCard.swift` so the view file stays
/// declarative and so the renderer (which is an actor) can also tap it
/// directly when we ever want to pre-bake a stand-alone QR PNG.
enum QRCodeRenderer {

    /// Builds a `CGImage` representation of `text` encoded as a QR code.
    /// Returns nil if CoreImage refuses (empty string, encoder failure,
    /// platform without CIFilterBuiltins).
    static func cgImage(for text: String) -> CGImage? {
        #if canImport(CoreImage)
        guard !text.isEmpty else { return nil }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        // "H" = ~30% redundancy — survives logo overlays and aggressive
        // social-media re-compression, at the cost of a denser pattern.
        filter.correctionLevel = "H"
        guard let output = filter.outputImage else { return nil }

        // Scale up the 25×25-ish base raster to a crisp ~300px so the QR
        // remains scannable after the SwiftUI hierarchy is rasterised
        // through `ImageRenderer` at 3x device scale.
        let transform = CGAffineTransform(scaleX: 12, y: 12)
        let scaled = output.transformed(by: transform)
        let context = CIContext(options: [.useSoftwareRenderer: false])
        return context.createCGImage(scaled, from: scaled.extent)
        #else
        return nil
        #endif
    }
}
