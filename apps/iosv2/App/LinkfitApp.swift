import SwiftUI

@main
struct LinkfitApp: App {
    @State private var container = AppContainer()

    init() {
        AppearanceBootstrap.apply()
    }

    var body: some Scene {
        WindowGroup {
            RootView(container: container)
        }
    }
}
