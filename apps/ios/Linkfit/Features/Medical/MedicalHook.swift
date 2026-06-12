import Foundation

// MARK: - Integration hooks for the Medical agent
//
// This file is the contract surface between the Medical feature and the
// other features that need to point at it. The Medical agent owns the
// files in `Features/Medical/**` exclusively; any sibling feature that
// wants to surface a "Medical info" entry, a waiver gate, or the
// host-only medical sheet wires it up via the comment-doc patterns
// below. No runtime dependency is created — these are integration notes,
// not exported symbols.
//
// Why a comment-doc file? Feature ownership is enforced per-folder. If
// the Profile agent ever needs to add a row to its Settings list, that
// agent edits its own file and references the Medical entry point
// described here. Likewise for GameDetail. Keeps blast radius small and
// reviews readable.
//
// ─────────────────────────────────────────────────────────────────────
// 1) Settings / Profile entry — "Medical info"
// ─────────────────────────────────────────────────────────────────────
//
// In `Features/Profile/ProfileView.swift` (Profile-agent territory), add
// a NavigationLink that pushes `MedicalProfileView`:
//
//   NavigationLink {
//       MedicalProfileView(
//           viewModel: MedicalProfileViewModel(apiClient: container.apiClient)
//       )
//   } label: {
//       SettingsRow(
//           icon: "cross.case.fill",
//           title: "settings.medical_info",
//           subtitle: "settings.medical_info.helper"
//       )
//   }
//
// Localization keys used (already present in the medical block of
// `Localizable.xcstrings`): `settings.medical_info`,
// `settings.medical_info.helper`. If those keys live under the Profile
// agent's owned block, that block can re-author them — the medical
// xcstrings entries are scoped to in-feature strings.
//
// ─────────────────────────────────────────────────────────────────────
// 2) Tournament register — waiver gate
// ─────────────────────────────────────────────────────────────────────
//
// In `Features/Tournaments/TournamentDetailView.swift`, the existing
// "Register" CTA path should present `WaiverSheet` first; on `onSigned`
// the existing register sheet is triggered. The waiver POST is
// idempotent so re-prompting on a returning user is safe:
//
//   .sheet(isPresented: $showWaiver) {
//       WaiverSheet(
//           tournamentId: detail.id,
//           tournamentName: detail.name,
//           apiClient: container.apiClient,
//           onSigned: { showRegisterSheet = true }
//       )
//   }
//
// The backend exposes `MedicalService.hasSignedWaiver(...)` so a future
// "Register" pre-flight can skip the sheet entirely for users who have
// already signed. Today the sheet is shown unconditionally — the user
// can dismiss without re-signing if they want.
//
// ─────────────────────────────────────────────────────────────────────
// 3) GameDetail — host-only "Medical info" button
// ─────────────────────────────────────────────────────────────────────
//
// In `Features/Games/GameDetailView.swift` add a toolbar item or
// inline button, gated on `game.host_user_id == container.currentUser?.id`,
// that presents `GameMedicalSheet`:
//
//   if game.host_user_id == container.currentUser?.id {
//       Button {
//           showMedicalSheet = true
//       } label: {
//           Label("medical.host_sheet.cta", systemImage: "cross.case")
//       }
//   }
//   .sheet(isPresented: $showMedicalSheet) {
//       GameMedicalSheet(gameId: game.id, apiClient: container.apiClient)
//   }
//
// The sheet handles its own loading / empty / 403-error states, so the
// host-side view doesn't need to know anything about the medical API.
//
// ─────────────────────────────────────────────────────────────────────
// 4) Stable contract
// ─────────────────────────────────────────────────────────────────────
//
// Public types other features may reference:
//
//   - MedicalProfileView, MedicalProfileViewModel
//   - WaiverSheet, WaiverViewModel
//   - GameMedicalSheet, GameMedicalViewModel
//   - Endpoint<MedicalProfile>.medicalProfile / .updateMedicalProfile(...)
//   - Endpoint<GameMedicalSummary>.gameMedicalSummary(gameId:)
//   - Endpoint<WaiverSignResponse>.signTournamentWaiver(tournamentId:)
//
// Anything else is implementation detail and may change without notice.

/// Compile-time anchor — keeps this file referenced by the build so the
/// integration notes don't get stripped by an aggressive "dead Swift file"
/// cleanup. Has no runtime cost.
enum MedicalHook {
    /// Version stamp the docs above refer to. Bump when any of the public
    /// types listed in section 4 change shape.
    static let contractVersion = "1.0"
}
