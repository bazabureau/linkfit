import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Sheet that lets the user preview, switch variants, and share the
/// generated match result card.
///
/// Flow:
/// 1. The sheet renders the card live (no network).
/// 2. The user picks Story vs Square.
/// 3. Tapping Share rasterises the SwiftUI view through `ShareCardRenderer`,
///    drops a PNG into `tmp/`, then presents the system Share Sheet.
struct ShareCardPreviewSheet: View {
    let data: ShareCardData

    @State private var variant: ShareCardVariant = .story
    @State private var isRendering: Bool = false
    @State private var isSharingToStories: Bool = false
    @State private var showStoryCreator: Bool = false
    @State private var renderedImageForStory: UIImage? = nil
    @State private var sharePayload: SharePayload?
    @State private var errorMessage: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(AppContainer.self) private var container
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: DSSpacing.lg) {
                        header
                        variantSwitch
                        preview
                        if let errorMessage {
                            Text(errorMessage)
                                .font(DSType.footnote)
                                .foregroundStyle(DSColor.danger)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, DSSpacing.md)
                        }
                        shareToStoriesButton
                        shareButton
                    }
                    .padding(DSSpacing.lg)
                }
            }
            .navigationTitle(Text("share_card.sheet.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Text("share_card.close")
                    }
                    .accessibilityLabel(Text("share_card.close"))
                }
            }
            .sheet(item: $sharePayload) { payload in
                ActivityShareSheet(items: [payload.url])
                    .ignoresSafeArea()
            }
            .fullScreenCover(isPresented: $showStoryCreator) {
                if let image = renderedImageForStory {
                    StoryCreator(
                        viewModel: StoryCreatorViewModel(
                            apiClient: container.apiClient,
                            initialImage: image,
                            onPosted: { story in
                                showStoryCreator = false
                                dismiss() // Dismiss the share card sheet too!
                            }
                        ),
                        onDismiss: { showStoryCreator = false }
                    )
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(.ultraThinMaterial)
    }

    // MARK: - Pieces

    private var header: some View {
        VStack(spacing: DSSpacing.xs) {
            Text("share_card.sheet.title")
                .font(DSType.displayMedium)
                .foregroundStyle(DSColor.textPrimary)
            Text("share_card.sheet.subtitle")
                .font(DSType.body)
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }

    private var variantSwitch: some View {
        HStack(spacing: 0) {
            variantTab(.story, labelKey: "share_card.variant.story")
            variantTab(.square, labelKey: "share_card.variant.square")
        }
        .padding(DSSpacing.xxs)
        .background(
            Capsule().fill(DSColor.surface)
        )
        .overlay(
            Capsule().strokeBorder(DSColor.border, lineWidth: 1)
        )
        .frame(maxWidth: 320)
    }

    private func variantTab(_ option: ShareCardVariant, labelKey: LocalizedStringKey) -> some View {
        let active = variant == option
        return Button {
            UISelectionFeedbackGenerator().selectionChanged()
            withAnimation(reduceMotion ? nil : .snappy(duration: 0.18)) {
                variant = option
            }
        } label: {
            Text(labelKey)
                .font(DSType.caption2)
                .foregroundStyle(active ? DSColor.textOnAccent : DSColor.textSecondary)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(
                    Capsule().fill(active ? DSColor.accent : Color.clear)
                )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private var preview: some View {
        let card = MatchResultCard(data: data, variant: variant)
        return card
            .scaleEffect(previewScale, anchor: .center)
            .frame(width: variant.pointSize.width * previewScale,
                   height: variant.pointSize.height * previewScale)
            .clipShape(RoundedRectangle(cornerRadius: 28))
            .overlay(
                RoundedRectangle(cornerRadius: 28)
                    .strokeBorder(DSColor.border, lineWidth: 1)
            )
            .shadow(color: DSColor.inkSurface.opacity(0.4), radius: 24, x: 0, y: 12)
            .animation(reduceMotion ? nil : .snappy(duration: 0.22), value: variant)
    }

    /// Story is taller than wide, so we down-sample more aggressively.
    /// Pick a scale that fits comfortably on iPhone Mini through Pro Max.
    private var previewScale: CGFloat {
        switch variant {
        case .story:  return 0.78
        case .square: return 0.9
        }
    }

    private var shareButton: some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            Task { await share() }
        } label: {
            HStack(spacing: DSSpacing.xs) {
                if isRendering {
                    ProgressView().tint(DSColor.textOnAccent)
                } else {
                    Image(systemName: "square.and.arrow.up.fill")
                }
                Text("share_card.share_button")
            }
            .font(DSType.button)
            .foregroundStyle(DSColor.textOnAccent)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(
                Capsule().fill(DSColor.accent)
            )
        }
        .buttonStyle(.plain)
        .disabled(isRendering)
        .padding(.top, DSSpacing.xs)
        .accessibilityLabel(Text("share_card.share_button"))
    }

    private var shareToStoriesButton: some View {
        Button {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            Task { await shareToStories() }
        } label: {
            HStack(spacing: DSSpacing.xs) {
                if isSharingToStories {
                    ProgressView().tint(DSColor.textPrimary)
                } else {
                    Image(systemName: "plus.circle.fill")
                }
                Text("game.action.share_to_story")
            }
            .font(DSType.button)
            .foregroundStyle(DSColor.textPrimary)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(
                Capsule().fill(DSColor.surfaceElevated)
            )
            .overlay(
                Capsule().strokeBorder(DSColor.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(isSharingToStories || isRendering)
        .accessibilityLabel(Text("game.action.share_to_story"))
    }

    // MARK: - Share

    private func share() async {
        isRendering = true
        errorMessage = nil
        defer { isRendering = false }
        do {
            let url = try await ShareCardRenderer.shared.writeTemporaryPNG(
                data: data, variant: variant
            )
            sharePayload = SharePayload(url: url)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch let err as ShareCardRenderError {
            errorMessage = err.errorDescription
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        } catch {
            errorMessage = error.localizedDescription
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }

    private func shareToStories() async {
        isSharingToStories = true
        errorMessage = nil
        defer { isSharingToStories = false }
        do {
            let image = try await MainActor.run {
                let card = MatchResultCard(data: data, variant: variant)
                let renderer = ImageRenderer(content: card)
                renderer.scale = UIScreen.main.scale
                renderer.proposedSize = ProposedViewSize(variant.pointSize)
                guard let uiImage = renderer.uiImage else {
                    throw ShareCardRenderError.rasterizationFailed
                }
                return uiImage
            }
            renderedImageForStory = image
            showStoryCreator = true
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch {
            errorMessage = error.localizedDescription
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }

    private struct SharePayload: Identifiable {
        let id = UUID()
        let url: URL
    }
}

// MARK: - UIActivityViewController bridge

/// Minimal `UIViewControllerRepresentable` wrapper around
/// `UIActivityViewController`. Lives next to the sheet because it has no
/// other consumer in the codebase right now — keep it local until a
/// second feature needs the same bridge, then promote it to Core/.
private struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

#Preview {
    ShareCardPreviewSheet(data: .preview)
}
