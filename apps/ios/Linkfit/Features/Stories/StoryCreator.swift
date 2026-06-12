import SwiftUI
import UIKit

/// Full-screen modal for creating a new story.
///
/// Flow (Wave-12 camera-first refactor + post-crop overlay editor):
///   1. `.camera`             → `StoryCameraView` — full-screen
///                               `AVCaptureSession` viewfinder with
///                               capture button + library-thumbnail
///                               shortcut + flip / flash chrome. This is
///                               the default landing.
///   2. `.editing(UIImage)`   → PhotoCropView for a square crop (rendered
///                               inline rather than as a nested
///                               fullScreenCover; nested covers were
///                               flaky on iOS 18 — sometimes the dismiss
///                               animation landed on the wrong stack).
///   3. `.editor(StoryEditorViewModel)` → Wave-12 overlay editor — text /
///                               mention / sticker placement with full
///                               drag/pinch/rotate gestures. Exits to
///                               `composing(image, overlays)` on "İrəli"
///                               or back to `camera` on close.
///   4. `.composing(UIImage, [StoryOverlay])` → cropped+annotated image +
///                               caption field + Post button. The
///                               overlay list is held in the phase so
///                               `post()` can convert it to the wire
///                               shape right before sending.
///   5. `.uploading`           → progress overlay; the host stays mounted
///                               so the user can see the determinate
///                               progress.
///   6. On success → `onPosted` fires, the host dismisses.
///
/// The host (HomeView) keeps this as a `.fullScreenCover` and dismisses
/// itself when the viewModel hits `.camera` after a successful post.
struct StoryCreator: View {
    @Bindable var viewModel: StoryCreatorViewModel
    /// Closure the host runs to tear down the cover. We could lean on
    /// `@Environment(\.dismiss)` but the host also needs to react to a
    /// successful post (refresh the rail) — using an explicit callback
    /// keeps both concerns in one place at the call site.
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch viewModel.phase {
            case .camera:
                StoryCameraView(
                    onCaptured: { image in viewModel.didPickImage(image) },
                    onDismiss: onDismiss
                )
            case .editing(let image):
                PhotoCropView(
                    image: image,
                    onCancel: { viewModel.cancelCrop() },
                    onConfirm: { cropped in viewModel.didConfirmCrop(cropped) }
                )
            case .editor(let editorVM):
                StoryEditorView(viewModel: editorVM)
            case .composing(let image, _):
                composingView(image: image)
            case .uploading(let progress):
                uploadingView(progress: progress)
            case .error(let message):
                errorView(message: message)
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(false)
    }

    // MARK: - Composing

    private func composingView(image: UIImage) -> some View {
        ZStack {
            // Cropped image fills behind a slight gradient so the
            // caption stays legible. The image is rendered at the
            // safe aspect — it's a square (PhotoCrop's output) so
            // fitting on a tall phone leaves room for the caption
            // and post button without overlap.
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity)
                .ignoresSafeArea()

            // Bottom gradient so the caption sits on legible ink.
            LinearGradient(
                colors: [.clear, .black.opacity(0.7)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)

            VStack {
                HStack {
                    Spacer()
                    closeButton
                }
                .padding(16)

                Spacer()

                // Caption + post button at the bottom — Instagram-y
                // bottom-anchored composer.
                VStack(spacing: 12) {
                    captionField

                    Button {
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        Task { await viewModel.post() }
                    } label: {
                        Text("stories.creator.action.post")
                            .font(.system(size: 16, weight: .heavy))
                            .foregroundStyle(DSColor.textOnAccent)
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                            .background(
                                Capsule()
                                    .fill(DSColor.accent)
                                    .shadow(color: DSColor.accent.opacity(0.4), radius: 10, y: 4)
                            )
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
        }
    }

    private var captionField: some View {
        TextField(
            "",
            text: $viewModel.caption,
            prompt: Text("stories.creator.caption_placeholder")
                .foregroundStyle(.white.opacity(0.6)),
            axis: .vertical
        )
        .lineLimit(1...3)
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.ultraThinMaterial.opacity(0.6))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(Color.white.opacity(0.15), lineWidth: 1)
        )
    }

    // MARK: - Uploading

    private func uploadingView(progress: Double) -> some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 20) {
                ZStack {
                    Circle()
                        .stroke(Color.white.opacity(0.2), lineWidth: 4)
                        .frame(width: 80, height: 80)
                    Circle()
                        .trim(from: 0, to: max(0.04, min(1.0, progress)))
                        .stroke(DSColor.accent, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .frame(width: 80, height: 80)
                        .animation(.easeOut(duration: 0.18), value: progress)
                    Text("\(Int(progress * 100))%")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white)
                }
                Text("stories.creator.action.post")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.85))
            }
        }
    }

    // MARK: - Error

    private func errorView(message: String) -> some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 44, weight: .light))
                    .foregroundStyle(DSColor.danger)
                Text(message)
                    .font(.system(size: 15))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                Button {
                    viewModel.dismissError()
                } label: {
                    Text("common.retry")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(DSColor.textOnAccent)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .background(Capsule().fill(DSColor.accent))
                }
                .buttonStyle(.plain)
            }
            .overlay(alignment: .topTrailing) { closeButton.padding(16) }
        }
    }

    // MARK: - Chrome

    private var closeButton: some View {
        Button {
            onDismiss()
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(Color.black.opacity(0.4), in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("common.close"))
    }
}
