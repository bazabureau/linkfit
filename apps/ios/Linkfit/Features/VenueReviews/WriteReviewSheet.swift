import SwiftUI
import PhotosUI

/// Modal sheet for composing a 1..5 star review with optional 500-char body
/// and one photo. Photo upload reuses the messaging upload pipeline — the
/// returned URL is the same kind of `/uploads/<uuid>.jpg` the chat agent
/// already hands out.
struct WriteReviewSheet: View {
    @State var viewModel: WriteReviewSheetViewModel
    /// Called when the user successfully posts a review. The parent screen
    /// folds the canonical row into its list.
    var onSubmitted: (VenueReview) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var pickedItem: PhotosPickerItem?

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: DSSpacing.lg) {
                        starsBlock
                        bodyBlock
                        photoBlock
                        if let err = viewModel.errorMessage {
                            Text(err)
                                .font(DSType.footnote)
                                .foregroundStyle(DSColor.danger)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.vertical, DSSpacing.lg)
                }
            }
            .navigationTitle(String(localized: "venue_reviews.write.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(String(localized: "venue_reviews.write.cancel")) {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task {
                            if let review = await viewModel.submit() {
                                onSubmitted(review)
                                dismiss()
                            }
                        }
                    } label: {
                        if viewModel.isSubmitting {
                            ProgressView()
                        } else {
                            Text("venue_reviews.write.submit")
                                .fontWeight(.semibold)
                        }
                    }
                    .disabled(!viewModel.canSubmit)
                }
            }
            .onChange(of: pickedItem) { _, newItem in
                guard let newItem else { return }
                Task { await handlePicked(newItem) }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(.ultraThinMaterial)
    }

    // MARK: - Sections

    private var starsBlock: some View {
        VStack(spacing: DSSpacing.sm) {
            Text("venue_reviews.write.rating_prompt")
                .font(DSType.title)
                .foregroundStyle(DSColor.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
            StarRow(value: Double(viewModel.rating),
                    selection: Binding(get: { viewModel.rating },
                                       set: { viewModel.rating = $0 }),
                    variant: .large)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, DSSpacing.sm)
            Text(ratingLabel(viewModel.rating))
                .font(DSType.caption)
                .foregroundStyle(DSColor.textSecondary)
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .padding(DSSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .fill(DSColor.surface)
        )
    }

    private var bodyBlock: some View {
        VStack(alignment: .leading, spacing: DSSpacing.xs) {
            Text("venue_reviews.write.body_prompt")
                .font(DSType.bodyEmphasis)
                .foregroundStyle(DSColor.textPrimary)
            ZStack(alignment: .topLeading) {
                if viewModel.body.isEmpty {
                    Text("venue_reviews.write.body_placeholder")
                        .font(DSType.body)
                        .foregroundStyle(DSColor.textTertiary)
                        .padding(.horizontal, DSSpacing.sm)
                        .padding(.vertical, DSSpacing.sm + 2)
                }
                TextEditor(text: $viewModel.body)
                    .font(DSType.body)
                    .foregroundStyle(DSColor.textPrimary)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 120)
                    .padding(.horizontal, DSSpacing.xs)
                    .padding(.vertical, DSSpacing.xs)
            }
            .background(
                RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                    .fill(DSColor.surfaceElevated)
            )
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                    .strokeBorder(DSColor.border, lineWidth: 1)
            )
            .onChange(of: viewModel.body) { _, newValue in
                if newValue.count > WriteReviewSheetViewModel.bodyMaxLength {
                    viewModel.body = String(newValue.prefix(WriteReviewSheetViewModel.bodyMaxLength))
                }
            }
            HStack {
                Spacer()
                Text("\(viewModel.trimmedBody.count) / \(WriteReviewSheetViewModel.bodyMaxLength)")
                    .font(DSType.caption)
                    .foregroundStyle(DSColor.textTertiary)
                    .monospacedDigit()
            }
        }
    }

    private var photoBlock: some View {
        let hasPhoto = viewModel.uploadedPhotoUrl != nil
        return VStack(alignment: .leading, spacing: DSSpacing.xs) {
            Text("venue_reviews.write.photo_prompt")
                .font(DSType.bodyEmphasis)
                .foregroundStyle(DSColor.textPrimary)
            HStack(spacing: DSSpacing.sm) {
                photoPreview
                Spacer()
                PhotosPicker(selection: $pickedItem,
                             matching: .images,
                             photoLibrary: .shared()) {
                    HStack(spacing: DSSpacing.xs) {
                        Image(systemName: hasPhoto
                              ? "arrow.triangle.2.circlepath"
                              : "photo.badge.plus")
                        Text(hasPhoto
                             ? "venue_reviews.write.photo_change"
                             : "venue_reviews.write.photo_add")
                    }
                    .font(DSType.buttonLabel)
                    .foregroundStyle(DSColor.textOnAccent)
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.vertical, DSSpacing.sm)
                    .background(
                        Capsule().fill(DSColor.accent)
                    )
                }
                .disabled(viewModel.isUploadingPhoto || viewModel.isSubmitting)
            }
            if viewModel.uploadedPhotoUrl != nil || viewModel.pendingImageData != nil {
                Button(role: .destructive) {
                    viewModel.clearPhoto()
                } label: {
                    Label("venue_reviews.write.photo_remove", systemImage: "trash")
                        .font(DSType.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(DSColor.danger)
            }
        }
    }

    @ViewBuilder
    private var photoPreview: some View {
        if let data = viewModel.pendingImageData,
           let uiImage = UIImage(data: data) {
            ZStack {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 72, height: 72)
                    .clipShape(RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous))
                if viewModel.isUploadingPhoto {
                    RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                        .fill(.black.opacity(0.45))
                        .frame(width: 72, height: 72)
                    UploadProgressRing(progress: viewModel.uploadProgress)
                        .frame(width: 40, height: 40)
                        .accessibilityLabel(Text("upload.in_progress"))
                }
            }
        } else if viewModel.uploadFailed {
            // pendingImageData is cleared on failure today, so we
            // render a "failed" placeholder rather than the preview.
            ZStack {
                RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                    .fill(DSColor.surfaceElevated)
                    .frame(width: 72, height: 72)
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(DSColor.danger)
                    .accessibilityLabel(Text("upload.failed"))
            }
        } else if let urlString = viewModel.uploadedPhotoUrl, let url = URL(string: urlString) {
            CachedAsyncImage(url: url) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                    .fill(DSColor.surfaceElevated)
            }
            .frame(width: 72, height: 72)
            .clipShape(RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous))
        } else {
            RoundedRectangle(cornerRadius: DSRadius.sm, style: .continuous)
                .fill(DSColor.surfaceElevated)
                .frame(width: 72, height: 72)
                .overlay {
                    Image(systemName: "photo")
                        .foregroundStyle(DSColor.textTertiary)
                }
        }
    }

    // MARK: - Helpers

    private func handlePicked(_ item: PhotosPickerItem) async {
        defer { pickedItem = nil }
        guard let raw = try? await item.loadTransferable(type: Data.self) else { return }
        let bytes: Data
        let mime: String
        if let image = UIImage(data: raw), let jpeg = image.jpegData(compressionQuality: 0.85) {
            bytes = jpeg
            mime = "image/jpeg"
        } else {
            bytes = raw
            mime = "image/jpeg"
        }
        await viewModel.uploadPhoto(bytes, mimeType: mime)
    }

    private func ratingLabel(_ value: Int) -> LocalizedStringKey {
        switch value {
        case 1: return "venue_reviews.rating.label.1"
        case 2: return "venue_reviews.rating.label.2"
        case 3: return "venue_reviews.rating.label.3"
        case 4: return "venue_reviews.rating.label.4"
        case 5: return "venue_reviews.rating.label.5"
        default: return "venue_reviews.rating.label.empty"
        }
    }
}

/// Determinate circular progress ring with a faint track. Used as the
/// in-flight upload indicator on the review-photo preview. The
/// `progress` value is animated, so even though URLSession delivers
/// updates at irregular intervals the ring's sweep stays smooth.
private struct UploadProgressRing: View {
    let progress: Double

    var body: some View {
        ZStack {
            Circle()
                .stroke(DSColor.textOnAccent.opacity(0.25), lineWidth: 3)
            Circle()
                .trim(from: 0, to: max(0.02, min(1.0, progress)))
                .stroke(DSColor.textOnAccent,
                        style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.easeOut(duration: 0.18), value: progress)
        }
    }
}
