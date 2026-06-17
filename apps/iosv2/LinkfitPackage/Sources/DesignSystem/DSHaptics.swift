import AppCore

/// Shared haptics handle for design-system components (buttons, chips). Features
/// can keep using injected `Haptics`; this is just so a `PrimaryButton` can ping
/// feedback without every call site wiring it up.
@MainActor public let dsHaptics: Haptics = SystemHaptics()
