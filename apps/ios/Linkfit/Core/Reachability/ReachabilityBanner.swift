import SwiftUI

/// Thin red strip pinned to the top of the screen whenever the device has
/// no usable network path. Slides down from above the safe area when
/// connectivity drops and slides back up when it returns.
///
/// Designed to be overlaid at the app root via
/// `.overlay(alignment: .top) { ReachabilityBanner() }` so it sits above
/// every navigation stack, sheet host, and tab bar. Pure presentation —
/// the visibility state comes from `ReachabilityMonitor.shared`.
///
/// The banner extends into the status-bar safe area (so the red bleed
/// reaches the very top of the screen) while keeping its text below the
/// notch / status bar via an explicit padding equal to the safe-area
/// inset. 32pt is the strip height *below* the status bar; the visible
/// red surface above that is the inset.
struct ReachabilityBanner: View {
    @State private var monitor = ReachabilityMonitor.shared

    var body: some View {
        // Drive a slide-from-top + fade transition off the observable
        // `isReachable` flag. The outer container is always laid out so
        // the overlay anchor doesn't reflow when the banner appears /
        // disappears — only the inner strip enters / exits.
        ZStack(alignment: .top) {
            if !monitor.isReachable {
                bannerStrip
                    .transition(
                        .asymmetric(
                            insertion: .move(edge: .top).combined(with: .opacity),
                            removal: .move(edge: .top).combined(with: .opacity)
                        )
                    )
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .allowsHitTesting(false) // banner is informational; don't swallow taps below
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: monitor.isReachable)
        .accessibilityElement(children: .combine)
        .accessibilityHidden(monitor.isReachable)
        // Kick off `NWPathMonitor` once the banner mounts. `start()` is
        // idempotent — a second `.task` firing on view rebuild is a
        // no-op. Co-locating the start here (rather than threading
        // another line into `LinkfitApp.swift`) keeps the reachability
        // surface entirely inside `Core/Reachability/`.
        .task { monitor.start() }
    }

    private var bannerStrip: some View {
        Text("reachability.offline")
            .font(DSType.caption)
            .foregroundStyle(DSColor.textOnAccent)
            .frame(maxWidth: .infinity)
            .frame(height: 32)
            .background(
                DSColor.danger
                    .ignoresSafeArea(edges: .top)
            )
            .accessibilityLabel(Text("reachability.offline"))
    }
}

#Preview {
    ZStack {
        DSColor.background.ignoresSafeArea()
        VStack { Text("Content underneath").foregroundStyle(DSColor.textPrimary) }
    }
    .overlay(alignment: .top) { ReachabilityBanner() }
}
