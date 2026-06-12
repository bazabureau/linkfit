// LinkfitLiveActivityBundle.swift
//
// Widget extension entry point for the ActivityKit-only extension.
//
// This is a SEPARATE app extension from `LinkfitWidgets` — they are
// two distinct app-extension targets bundled inside the host
// `Linkfit.app`. Apple supports multiple widget extensions in a
// single app, and we use that here so:
//
//   • The Live Activity / Dynamic Island code (this target) and the
//     home-screen / lock-screen WidgetKit code (`LinkfitWidgets`)
//     can be owned by different agents without overlapping files.
//   • Each extension declares its own `@main` `WidgetBundle`, so the
//     two targets cannot ever collide on the @main attribute.
//
// If a future agent wants to consolidate into a single extension,
// it must coordinate ownership with both the Widget and LiveActivity
// agents.

import SwiftUI
import WidgetKit

@main
struct LinkfitLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        MatchLiveActivity()
    }
}
