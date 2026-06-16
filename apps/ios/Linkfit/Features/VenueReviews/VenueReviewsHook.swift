import SwiftUI

/// Integration glue for the **Venue reviews agent**. This file is owned by
/// the venue-reviews agent and is the single place the rest of the app
/// reaches in to embed reviews UI inside an existing venue surface.
///
/// We deliberately do NOT modify `VenuesView`, `VenueMapView`, or the
/// venue detail screen from here — those files belong to the venues
/// agent. Instead, that agent calls these factory helpers when it wants
/// an "Add review" button on a card or a full-screen reviews list inside
/// the existing navigation stack.
///
/// Suggested embedding points (for the venues agent to wire up):
///
/// 1. **Venue detail header.** Add a horizontal pill row beneath the
///    address that shows the aggregate stars + count. Tap pushes
///    `makeVenueReviewsView(...)` onto the existing `NavigationStack`.
///
///    ```swift
///    NavigationLink {
///        VenueReviewsHook.makeVenueReviewsView(
///            venueId: venue.id,
///            apiClient: apiClient,
///            currentUserId: session.userId
///        )
///    } label: { VenueReviewsHook.RatingPill(summary: summary) }
///    ```
///
/// 2. **Venue map card sheet.** When the user taps a pin and the
///    bottom-sheet card opens, place a secondary CTA — "Write a review" —
///    next to the existing "Book a court" button. That CTA presents
///    `makeWriteReviewSheet(...)` as a `.sheet`.
///
/// 3. **Venues list row.** Append `RatingPill` to the trailing edge of
///    each row so users can scan at a glance which venues are top-rated
///    before they tap in.
///
/// The hook owns nothing — every entry point returns a stateless view.
/// Routing, dismissal, and post-submit refresh stay with the parent.
enum VenueReviewsHook {
    /// Factory for the full reviews surface — typically pushed inside a
    /// NavigationStack from the venue detail screen.
    @MainActor
    static func makeVenueReviewsView(
        venueId: String,
        apiClient: APIClient,
        currentUserId: String?,
        onRequestWrite: (() -> Void)? = nil
    ) -> some View {
        VenueReviewsHostView(
            venueId: venueId,
            apiClient: apiClient,
            currentUserId: currentUserId,
            externalWriteHandler: onRequestWrite
        )
    }

    /// Factory for the write-review modal. Hosts can present this from a
    /// map-card "Add review" button without taking on the full list
    /// screen. `onSubmitted` fires with the canonical row so the caller
    /// can invalidate any cached aggregate.
    @MainActor
    static func makeWriteReviewSheet(
        venueId: String,
        apiClient: APIClient,
        prefill: VenueReview? = nil,
        onSubmitted: @escaping (VenueReview) -> Void
    ) -> some View {
        let vm = WriteReviewSheetViewModel(venueId: venueId, apiClient: apiClient)
        if let prefill { vm.prefill(from: prefill) }
        return WriteReviewSheet(viewModel: vm, onSubmitted: onSubmitted)
    }

    /// Compact aggregate pill — meant for venue card / row decoration.
    /// Shows "—" when no reviews exist; otherwise `★ 4.5 (12)`. Caller
    /// supplies the `summary` since cards typically already have it from
    /// a list endpoint that joins `venue_rating_summary`.
    struct RatingPill: View {
        let summary: VenueRatingSummary?

        var body: some View {
            HStack(spacing: DSSpacing.xxs) {
                Image(systemName: "star.fill")
                    .font(DSType.badge)
                    .foregroundStyle(DSColor.warning)
                Text(label)
                    .font(DSType.caption)
                    .foregroundStyle(DSColor.textPrimary)
                    .monospacedDigit()
            }
            .padding(.horizontal, DSSpacing.xs)
            .padding(.vertical, 4)
            .background(
                Capsule().fill(DSColor.surfaceElevated)
            )
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("venue_reviews.pill.a11y"))
            .accessibilityValue(Text(label))
        }

        private var label: String {
            guard let summary, let avg = summary.avg_rating else { return "—" }
            return String(format: "%.1f (%d)", avg, summary.review_count)
        }
    }
}

/// Internal host view that owns the `VenueReviewsViewModel` and presents
/// `WriteReviewSheet` over the list. Kept private so callers always go
/// through `VenueReviewsHook.makeVenueReviewsView(...)`.
private struct VenueReviewsHostView: View {
    let venueId: String
    let apiClient: APIClient
    let currentUserId: String?
    let externalWriteHandler: (() -> Void)?

    @State private var listViewModel: VenueReviewsViewModel
    @State private var sheetState: SheetState?

    init(venueId: String,
         apiClient: APIClient,
         currentUserId: String?,
         externalWriteHandler: (() -> Void)?) {
        self.venueId = venueId
        self.apiClient = apiClient
        self.currentUserId = currentUserId
        self.externalWriteHandler = externalWriteHandler
        self._listViewModel = State(initialValue: VenueReviewsViewModel(
            venueId: venueId, apiClient: apiClient
        ))
    }

    private enum SheetState: Identifiable {
        case new
        case edit(VenueReview)
        var id: String {
            switch self {
            case .new: return "new"
            case .edit(let r): return "edit-\(r.id)"
            }
        }
    }

    var body: some View {
        VenueReviewsView(
            viewModel: listViewModel,
            onWriteReviewTap: {
                if let externalWriteHandler {
                    externalWriteHandler()
                } else {
                    sheetState = .new
                }
            },
            onEditMyReviewTap: { review in
                sheetState = .edit(review)
            },
            currentUserId: currentUserId
        )
        .sheet(item: $sheetState) { state in
            let prefill: VenueReview? = {
                if case .edit(let r) = state { return r }
                return nil
            }()
            VenueReviewsHook.makeWriteReviewSheet(
                venueId: venueId,
                apiClient: apiClient,
                prefill: prefill
            ) { review in
                Task { await listViewModel.acceptNewReview(review) }
            }
        }
    }
}
