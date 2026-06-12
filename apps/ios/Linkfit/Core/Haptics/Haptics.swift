import UIKit

@MainActor
enum Haptics {
    /// Standard selection (chip tap, list row tap).
    static func selection() { UISelectionFeedbackGenerator().selectionChanged() }
    /// Soft impact (tab change, scroll-to-top).
    static func soft() { UIImpactFeedbackGenerator(style: .soft).impactOccurred() }
    /// Medium impact (primary CTA).
    static func medium() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
    /// Heavy impact (destructive action).
    static func heavy() { UIImpactFeedbackGenerator(style: .heavy).impactOccurred() }
    /// Success notification (after positive outcome).
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    /// Warning notification (about-to-confirm destructive).
    static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
    /// Error notification (failure surface).
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
}
