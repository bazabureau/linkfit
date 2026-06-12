import SwiftUI

/// View modifier that mounts the `ToastCenter` overlay at the bottom of the
/// host content. Apply once at the scene root — see `LinkfitApp` — and every
/// view in the tree can drive toasts via `ToastCenter.shared`.
///
/// Implementation notes:
/// * The overlay uses an `id`-keyed wrapper so a slide-in transition fires
///   on each new toast (not just when going `nil → some`).
/// * The transition is asymmetric: slide+fade from bottom on insert, plain
///   fade on remove, so a rapid swap doesn't visually "jump" off-screen.
/// * Tap to dismiss is routed through `ToastCenter.dismiss()` so the
///   auto-dismiss task is cancelled too.
struct ToastHost: ViewModifier {

    // Observed by reference — `ToastCenter` is `@Observable`, so any change
    // to `current` invalidates this body. Held as a let (not @State) since
    // the singleton instance never changes for the lifetime of the app.
    private let center = ToastCenter.shared

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                // Keyed by `id`, so when `current` changes from one toast to
                // another the old view leaves (fade) and the new one enters
                // (slide+fade) — instead of SwiftUI diffing them as the
                // same node and skipping the transition.
                if let toast = center.current {
                    ToastView(
                        toast: toast,
                        onTap: { center.dismiss() },
                        // Retry-kind toasts route their action through the
                        // center so the auto-dismiss task gets cancelled and
                        // double-taps can't trigger the closure twice.
                        onRetry: { center.performRetry() }
                    )
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.bottom, DSSpacing.md)
                    .transition(
                        .asymmetric(
                            insertion: .move(edge: .bottom).combined(with: .opacity),
                            removal: .opacity
                        )
                    )
                    .id(toast.id)
                }
            }
            // Drive the transition off `current?.id` so identity changes
            // (new toast) trigger animation even when the previous toast
            // was still present.
            .animation(.spring(response: 0.42, dampingFraction: 0.82),
                       value: center.current?.id)
    }
}

extension View {
    /// Mount the global toast overlay. Call once on the scene's root view.
    func toastHost() -> some View {
        modifier(ToastHost())
    }
}
