// RecurringHook.swift
//
// Purpose-built marker file describing HOW to wire the new
// `RecurringGameSheet` into the existing Games surface, WITHOUT touching
// `CreateGameView` or `CreateGameViewModel`. The recurring flow is a
// distinct sheet — keeping it separate means the canonical "create a
// one-off game" path stays simple and the new recurring code can evolve
// independently.
//
// Suggested integration (the owning agent will apply this):
//
//   // In whichever view holds the "+ Create game" entry point (Games tab
//   // root, e.g. GamesListView), add a small overflow menu / toggle so
//   // the host can pick:
//   //
//   //   • One-off game   → presents CreateGameView (unchanged)
//   //   • Weekly series  → presents RecurringGameSheet
//
//   import SwiftUI
//
//   struct GamesEntryMenu: View {
//       @State private var showCreateOneOff = false
//       @State private var showRecurring    = false
//       let apiClient: APIClient
//       var onGameCreated:    (GameDetail) -> Void
//       var onSeriesCreated:  (GameSeriesDetail) -> Void
//
//       var body: some View {
//           Menu {
//               Button {
//                   showCreateOneOff = true
//               } label: {
//                   Label("create_game.title", systemImage: "plus.circle")
//               }
//               Button {
//                   showRecurring = true
//               } label: {
//                   Label("recurring.title", systemImage: "calendar.badge.plus")
//               }
//           } label: {
//               Image(systemName: "plus")
//                   .fontWeight(.semibold)
//                   .foregroundStyle(DSColor.accent)
//           }
//           .accessibilityLabel(Text("matches.create"))
//           .sheet(isPresented: $showCreateOneOff) {
//               // Existing flow — unchanged.
//               CreateGameView(
//                   viewModel: CreateGameViewModel(apiClient: apiClient),
//                   onCreated: { game in
//                       showCreateOneOff = false
//                       onGameCreated(game)
//                   }
//               )
//           }
//           .sheet(isPresented: $showRecurring) {
//               RecurringGameSheet(
//                   viewModel: RecurringGameViewModel(apiClient: apiClient),
//                   onCreated: { series in
//                       showRecurring = false
//                       onSeriesCreated(series)
//                   }
//               )
//           }
//       }
//   }
//
// Why a separate sheet, not a toggle on CreateGameView:
//
// 1. The recurring inputs (day-of-week picker, weeks slider, time picker)
//    don't fit cleanly onto CreateGameView's date-and-time form without
//    growing the surface or branching the model. A sibling sheet keeps
//    both flows tight and focused.
// 2. The success state is fundamentally different ("12 games scheduled"
//    vs. one game detail) — composing it into CreateGameView would
//    require an enum result type and a swap-in card. Cleaner as two views.
// 3. Lets us evolve recurring (e.g. fortnightly, custom byweekday) without
//    polluting the canonical create flow.
//
// File ownership note:
//   This file is a documentation marker — it intentionally contains no
//   compilable types so it's safe to ship in the build without any
//   integration code yet. The wiring above is a suggestion for the agent
//   that owns the Games tab root view.
