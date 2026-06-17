import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Haptic feedback ladder (see DESIGN_GUIDELINES): light = secondary actions,
/// medium = primary CTA, selection = pickers/tabs, success/error = outcomes.
/// `@MainActor` because UIKit feedback generators must run on the main thread.
@MainActor public protocol Haptics: Sendable {
    func light()
    func medium()
    func selection()
    func success()
    func error()
}

@MainActor public final class SystemHaptics: Haptics {
    public init() {}

    #if canImport(UIKit)
    public func light() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    public func medium() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
    public func selection() { UISelectionFeedbackGenerator().selectionChanged() }
    public func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    public func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
    #else
    public func light() {}
    public func medium() {}
    public func selection() {}
    public func success() {}
    public func error() {}
    #endif
}

/// No-op variant for previews / tests.
@MainActor public final class NoopHaptics: Haptics {
    public init() {}
    public func light() {}
    public func medium() {}
    public func selection() {}
    public func success() {}
    public func error() {}
}
