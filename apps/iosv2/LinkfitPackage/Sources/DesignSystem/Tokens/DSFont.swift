import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Typographic roles. SF Pro (system) for all product UI; sentence case, no
/// tracking, no uppercase (see DESIGN_GUIDELINES). The display face hook
/// (`wordmark`) uses Plus Jakarta Sans when the resource is bundled in the app,
/// otherwise it falls back to a heavy system font.
public enum DSFont {
    public static let hero = Font.system(size: 28, weight: .heavy)
    public static let title = Font.system(size: 22, weight: .bold)
    public static let section = Font.system(size: 18, weight: .heavy)
    public static let cardTitle = Font.system(size: 15, weight: .heavy)
    public static let body = Font.system(size: 15, weight: .regular)
    public static let bodyMedium = Font.system(size: 15, weight: .medium)
    public static let bodySemibold = Font.system(size: 15, weight: .semibold)
    public static let callout = Font.system(size: 14, weight: .medium)
    public static let caption = Font.system(size: 12, weight: .semibold)
    public static let micro = Font.system(size: 11, weight: .heavy)
    public static let button = Font.system(size: 15, weight: .semibold)

    /// Brand display face. Returns Plus Jakarta Sans if registered, else system.
    public static func wordmark(size: CGFloat) -> Font {
        if isPlusJakartaAvailable {
            return .custom("PlusJakartaSans-Bold", size: size)
        }
        return .system(size: size, weight: .heavy)
    }

    nonisolated(unsafe) private static let isPlusJakartaAvailable: Bool = {
        #if canImport(UIKit)
        return UIFont(name: "PlusJakartaSans-Bold", size: 12) != nil
        #else
        return false
        #endif
    }()
}
