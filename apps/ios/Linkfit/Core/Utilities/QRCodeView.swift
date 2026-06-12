import SwiftUI
import CoreImage
import CoreImage.CIFilterBuiltins

/// SwiftUI QR code renderer. Wraps Apple's `CIQRCodeGenerator` and
/// presents the result as a sharp, scalable `Image`.
///
/// Used by the booking confirmation screen: the business scans this
/// QR on the user's phone to verify the booking. The payload is the
/// canonical Linkfit booking URL (`linkfit://booking/<id>`) so the
/// staff's own scanner — or any consumer QR app — can resolve it.
///
/// Why we render via `CIContext`-backed CGImage rather than just
/// `Image(uiImage:)` from the filter's output: the raw CIImage is
/// 23×23 pixels and would look like a blurry mess when scaled. We
/// upsample with nearest-neighbour interpolation so the modules stay
/// crisp at any size.
struct BookingQRCodeView: View {
    let content: String
    var tint: Color = .black
    var background: Color = .white
    /// Side length in points. The internal raster is scaled to ~5×
    /// this number to keep the modules razor-sharp on retina screens.
    var size: CGFloat = 200

    var body: some View {
        Group {
            if let image = generate() {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
            } else {
                // Fallback — extremely rare (would require the
                // CoreImage filter to fail entirely). Show a hint so
                // the user can still complete check-in by reading
                // out the booking ID.
                Text(content)
                    .font(.system(.footnote, design: .monospaced))
                    .padding()
                    .multilineTextAlignment(.center)
            }
        }
        .frame(width: size, height: size)
        .padding(12)
        .background(background)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityLabel(Text("qr.code.voice"))
    }

    private func generate() -> UIImage? {
        guard let data = content.data(using: .utf8) else { return nil }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = data
        filter.correctionLevel = "H" // 30% recovery — survives crops + glare
        guard let ciOutput = filter.outputImage else { return nil }
        // Upsample so the raster matches the requested display size.
        // We multiply by 8 to keep modules sharp even when the user
        // hands their phone to bright shop lights.
        let scale: CGFloat = 8
        let scaled = ciOutput.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let ctx = CIContext()
        guard let cgImage = ctx.createCGImage(scaled, from: scaled.extent) else {
            return nil
        }
        return UIImage(cgImage: cgImage)
    }
}
