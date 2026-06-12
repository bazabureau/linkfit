//
//  WidgetHook.swift
//  Linkfit
//
//  Integration recipe for keeping `LinkfitWidget` in sync with the app's
//  canonical state. The widget agent does NOT modify HomeViewModel or
//  MyBookingsViewModel directly — that's owned by other agents. Instead this
//  file documents the one-line call sites the owning agents should add when
//  they next touch those view models.
//
//  ────────────────────────────────────────────────────────────────────────
//  Where to hook (read-only documentation — no behavior in this file)
//  ────────────────────────────────────────────────────────────────────────
//
//  1. HomeViewModel.onAppear / after-refresh:
//
//      import Foundation
//      // …inside the success path of load() / refresh():
//      let game = upcomingGames.first.map {
//          WidgetGame(
//              id: $0.id,
//              sport: $0.sport.displayName,
//              startsAt: $0.startsAt,
//              venueName: $0.venue?.name ?? ""
//          )
//      }
//      WidgetCache.shared.update(
//          nextGame: game,
//          currentStreak: stats?.streakWeeks ?? 0,
//          unreadConversations: inboxBadge
//      )
//
//  2. MyBookingsViewModel.load:
//
//      // Same pattern — call WidgetCache.shared.update(…) once the freshest
//      // bookings list is in hand. If MyBookings returns earlier than Home,
//      // it can still write because `update` is idempotent.
//
//  3. Streaks feature, after server confirms a streak increment:
//
//      WidgetCache.shared.currentStreak = newStreakCount
//      WidgetCache.shared.reloadWidgetTimelines()
//
//  4. Sign-out:
//
//      WidgetCache.shared.update(
//          nextGame: nil, currentStreak: 0, unreadConversations: 0
//      )
//      // Clears the lock-screen widget so a logged-out device shows the
//      // "No games scheduled" empty state.
//
//  ────────────────────────────────────────────────────────────────────────
//  Why centralized here
//  ────────────────────────────────────────────────────────────────────────
//  - The widget can't make network calls — only the app process can. By
//    funnelling all writes through `WidgetCache.shared.update`, we guarantee
//    `lastUpdated` is touched and WidgetKit is told to reload, in one place.
//  - Future widgets (e.g. tournament countdown) add new keys to
//    `WidgetCache` and a new hook site in the matching view model — no churn
//    to the timeline provider.
//
//  This file intentionally contains no executable code. It exists so a new
//  contributor searching for "WidgetCache" finds the integration contract
//  before touching the view models.

import Foundation
