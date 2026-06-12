import SwiftUI

/// Linkfit brand mark — a 6-petal floret radiating from a tight center,
/// echoing both a tennis-court spotlight and a "linked" star. Drawn with
/// Path so it scales crisply at every size from 16pt favicons to 320pt
/// splash heroes.
///
/// Use the standard sizes (`.s`, `.m`, `.l`, `.xl`) for consistency; pass a
/// custom CGFloat only when you have a justified reason.
struct BrandMark: View {
    enum Size {
        case s, m, l, xl
        case custom(CGFloat)
        var pt: CGFloat {
            switch self {
            case .s: return 20
            case .m: return 32
            case .l: return 64
            case .xl: return 128
            case .custom(let v): return v
            }
        }
    }

    var size: Size = .l
    var color: Color = DSColor.accent

    var body: some View {
        Canvas { ctx, size in
            let cx = size.width / 2
            let cy = size.height / 2
            let r = min(size.width, size.height) / 2
            let petalLen = r * 0.95
            let petalWid = r * 0.36
            let coreR = r * 0.18

            for i in 0..<6 {
                let angle = Double(i) * (.pi / 3)
                var path = Path()
                let tipX = cx + cos(angle) * petalLen
                let tipY = cy + sin(angle) * petalLen
                let baseAngleA = angle + .pi / 2
                let baseAngleB = angle - .pi / 2
                let baseAX = cx + cos(baseAngleA) * petalWid * 0.45
                let baseAY = cy + sin(baseAngleA) * petalWid * 0.45
                let baseBX = cx + cos(baseAngleB) * petalWid * 0.45
                let baseBY = cy + sin(baseAngleB) * petalWid * 0.45
                let ctrlAX = cx + cos(angle) * petalLen * 0.6 + cos(baseAngleA) * petalWid
                let ctrlAY = cy + sin(angle) * petalLen * 0.6 + sin(baseAngleA) * petalWid
                let ctrlBX = cx + cos(angle) * petalLen * 0.6 + cos(baseAngleB) * petalWid
                let ctrlBY = cy + sin(angle) * petalLen * 0.6 + sin(baseAngleB) * petalWid

                path.move(to: CGPoint(x: baseAX, y: baseAY))
                path.addQuadCurve(
                    to: CGPoint(x: tipX, y: tipY),
                    control: CGPoint(x: ctrlAX, y: ctrlAY)
                )
                path.addQuadCurve(
                    to: CGPoint(x: baseBX, y: baseBY),
                    control: CGPoint(x: ctrlBX, y: ctrlBY)
                )
                path.closeSubpath()
                ctx.fill(path, with: .color(color))
            }

            // Cut a small core hole for definition (matches the reference dot).
            ctx.blendMode = .destinationOut
            ctx.fill(
                Path(ellipseIn: CGRect(x: cx - coreR, y: cy - coreR,
                                       width: coreR * 2, height: coreR * 2)),
                with: .color(.black)
            )
        }
        .frame(width: size.pt, height: size.pt)
        .accessibilityLabel("Linkfit")
        .accessibilityAddTraits(.isImage)
    }
}
