import SwiftUI

/// Reviews surface for a single venue. Top:
///   * Aggregate header — big star summary, total count, 5-bar histogram.
///   * Segmented sort picker (recent / highest).
/// Bottom:
///   * Pull-to-refresh list of reviews. Last visible row triggers
///     `loadMore()` automatically.
///
/// The "Write a review" CTA is delegated to the parent via
/// `onWriteReviewTap`. That keeps this screen embeddable from either a
/// venue detail navigation stack OR the venue-card map sheet, without
/// either context owning auth-routing state.
struct VenueReviewsView: View {
    @State var viewModel: VenueReviewsViewModel
    /// Tapped when the user has no review yet — opens `WriteReviewSheet`.
    var onWriteReviewTap: () -> Void
    /// Tapped when the user already has a review and wants to edit it.
    var onEditMyReviewTap: ((VenueReview) -> Void)? = nil
    /// Currently authenticated user id (or nil for anonymous viewers).
    /// Used to (a) hide the "Write" CTA when not signed in and (b) show
    /// the trash icon on the author's own row.
    var currentUserId: String?

    /// Review the user has tapped "delete" on; drives the destructive
    /// confirmation dialog so a deletion is never one accidental tap.
    @State private var pendingDelete: VenueReview?

    var body: some View {
        ZStack {
            DSColor.background.ignoresSafeArea()
            ScrollView {
                LazyVStack(spacing: DSSpacing.md, pinnedViews: []) {
                    summaryHeader
                    sortPicker
                    content
                }
                .padding(.horizontal, DSSpacing.md)
                .padding(.bottom, DSSpacing.xxl)
            }
        }
        .navigationTitle(String(localized: "venue_reviews.title"))
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                writeReviewToolbarButton
            }
        }
        .confirmationDialog(
            Text("venue_reviews.delete.confirm.title"),
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { review in
            Button(role: .destructive) {
                Haptics.warning()
                let target = review.id
                pendingDelete = nil
                Task { await viewModel.remove(target) }
            } label: {
                Text("venue_reviews.row.delete")
            }
            Button(role: .cancel) {
                pendingDelete = nil
            } label: {
                Text("common.cancel")
            }
        } message: { _ in
            Text("venue_reviews.delete.confirm.message")
        }
        .task { await viewModel.onAppear() }
        .refreshable { await viewModel.load() }
    }

    // MARK: - Header

    @ViewBuilder
    private var summaryHeader: some View {
        let summary = viewModel.summary
        VStack(spacing: DSSpacing.sm) {
            HStack(alignment: .center, spacing: DSSpacing.md) {
                VStack(alignment: .leading, spacing: DSSpacing.xxs) {
                    Text(avgDisplay(summary?.avg_rating))
                        .font(DSType.displayLarge)
                        .foregroundStyle(DSColor.textPrimary)
                        .monospacedDigit()
                    StarRow(value: summary?.avg_rating ?? 0,
                            variant: .small,
                            tint: DSColor.warning)
                    Text(String(format: NSLocalizedString("venue_reviews.summary.count_format",
                                                          comment: "Total number of reviews"),
                                summary?.review_count ?? 0))
                        .font(DSType.caption)
                        .foregroundStyle(DSColor.textSecondary)
                }
                Spacer()
                if let hist = summary?.histogram {
                    histogramView(hist, total: max(summary?.review_count ?? 1, 1))
                        .frame(maxWidth: 180)
                }
            }
        }
        .padding(DSSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .fill(DSColor.surface)
        )
    }

    private func histogramView(_ hist: VenueRatingHistogram, total: Int) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.xxs) {
            ForEach((1...5).reversed(), id: \.self) { star in
                HStack(spacing: DSSpacing.xs) {
                    Text("\(star)")
                        .font(DSType.caption)
                        .foregroundStyle(DSColor.textSecondary)
                        .frame(width: 10, alignment: .trailing)
                        .monospacedDigit()
                    Image(systemName: "star.fill")
                        .font(DSType.caption2)
                        .foregroundStyle(DSColor.warning)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(DSColor.surfaceElevated)
                            Capsule()
                                .fill(DSColor.warning.opacity(0.85))
                                .frame(width: barWidth(for: hist.count(for: star),
                                                       total: total,
                                                       max: geo.size.width))
                        }
                    }
                    .frame(height: 6)
                    Text("\(hist.count(for: star))")
                        .font(DSType.caption)
                        .foregroundStyle(DSColor.textTertiary)
                        .frame(width: 22, alignment: .trailing)
                        .monospacedDigit()
                }
            }
        }
    }

    private func barWidth(for count: Int, total: Int, max: CGFloat) -> CGFloat {
        guard total > 0 else { return 0 }
        return max * CGFloat(count) / CGFloat(total)
    }

    // MARK: - Sort

    private var sortPicker: some View {
        Picker("", selection: Binding(
            get: { viewModel.sort },
            set: { newValue in Task { await viewModel.setSort(newValue) } }
        )) {
            Text("venue_reviews.sort.recent").tag(VenueReviewsSort.recent)
            Text("venue_reviews.sort.highest").tag(VenueReviewsSort.highest)
        }
        .pickerStyle(.segmented)
    }

    // MARK: - Content list

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView(label: String(localized: "venue_reviews.loading"))
                .padding(.vertical, DSSpacing.xl)
        case .loaded(let rows):
            ForEach(rows) { review in
                ReviewRow(review: review,
                          isMine: review.author.id == currentUserId,
                          onEdit: {
                              onEditMyReviewTap?(review)
                          },
                          onDelete: {
                              pendingDelete = review
                          })
                .onAppear {
                    // Last row → load the next page.
                    if review.id == rows.last?.id { Task { await viewModel.loadMore() } }
                }
            }
            if viewModel.isLoadingMore {
                ProgressView().padding(.vertical, DSSpacing.md)
            }
        case .empty:
            EmptyStateView(icon: "star.bubble",
                           title: String(localized: "venue_reviews.empty.title"),
                           message: String(localized: "venue_reviews.empty.message"))
                .padding(.vertical, DSSpacing.xl)
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.load() } }
                .padding(.vertical, DSSpacing.xl)
        }
    }

    // MARK: - Toolbar

    @ViewBuilder
    private var writeReviewToolbarButton: some View {
        if currentUserId != nil {
            Button {
                onWriteReviewTap()
            } label: {
                Label("venue_reviews.write.cta", systemImage: "square.and.pencil")
                    .labelStyle(.iconOnly)
                    .foregroundStyle(DSColor.accent)
            }
            .accessibilityLabel(Text("venue_reviews.write.cta"))
        }
    }

    // MARK: - Helpers

    private func avgDisplay(_ avg: Double?) -> String {
        guard let avg else { return "—" }
        return String(format: "%.1f", avg)
    }
}

/// One row in the review list. Renders author avatar/name, star value, an
/// optional body, an optional photo, and a relative timestamp. The author
/// of a row sees a destructive delete affordance.
private struct ReviewRow: View {
    let review: VenueReview
    let isMine: Bool
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            HStack(spacing: DSSpacing.sm) {
                avatar
                VStack(alignment: .leading, spacing: 2) {
                    Text(review.author.display_name)
                        .font(DSType.bodyEmphasis)
                        .foregroundStyle(DSColor.textPrimary)
                    HStack(spacing: DSSpacing.xs) {
                        StarRow(value: Double(review.rating),
                                variant: .small,
                                tint: DSColor.warning)
                        Text(relativeDate(review.created_at))
                            .font(DSType.caption)
                            .foregroundStyle(DSColor.textTertiary)
                    }
                }
                Spacer()
                if isMine {
                    Menu {
                        Button {
                            onEdit()
                        } label: {
                            Label("venue_reviews.row.edit", systemImage: "square.and.pencil")
                        }
                        Button(role: .destructive) {
                            onDelete()
                        } label: {
                            Label("venue_reviews.row.delete", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(DSColor.textSecondary)
                            // Guarantee a HIG-compliant 44pt tap target —
                            // an 18pt glyph alone is far too small to hit.
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel(Text("venue_reviews.row.more_actions"))
                }
            }
            if let body = review.body, !body.isEmpty {
                Text(body)
                    .font(DSType.body)
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let urlString = review.photo_url, let url = URL(string: urlString) {
                CachedAsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    RoundedRectangle(cornerRadius: DSRadius.sm)
                        .fill(DSColor.surfaceElevated)
                }
                .frame(height: 180)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous))
            }
        }
        .padding(DSSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .fill(DSColor.surface)
        )
    }

    @ViewBuilder
    private var avatar: some View {
        if let urlString = review.author.photo_url, let url = URL(string: urlString) {
            CachedAsyncImage(url: url) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                initialsCircle
            }
            .frame(width: 36, height: 36)
            .clipShape(Circle())
        } else {
            initialsCircle
        }
    }

    private var initialsCircle: some View {
        ZStack {
            Circle()
                .fill(LinearGradient(colors: [DSColor.accent, DSColor.accentSoft],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 36, height: 36)
            Text(initials)
                .font(.system(.footnote, design: .default, weight: .bold))
                .foregroundStyle(DSColor.textOnAccent)
        }
    }

    private var initials: String {
        review.author.display_name
            .split(separator: " ")
            .prefix(2)
            .map { $0.prefix(1).uppercased() }
            .joined()
    }

    private func relativeDate(_ iso: String) -> String {
        // Parse through the tolerant `Date.fromISO` foundation (handles the
        // fractional-seconds shape the API ships). On a genuinely
        // unparseable value, render nothing rather than a misleading "now".
        guard let parsed = Date.fromISO(iso) else { return "" }
        let fmt = RelativeDateTimeFormatter()
        fmt.unitsStyle = .short
        return fmt.localizedString(for: parsed, relativeTo: Date())
    }
}
