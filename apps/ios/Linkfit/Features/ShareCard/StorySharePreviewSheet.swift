import SwiftUI

struct StorySharePreviewSheet: View {
    let image: UIImage
    @Environment(\.dismiss) private var dismiss
    @Environment(AppContainer.self) private var container
    
    @State private var isSharingToStories = false
    @State private var showStoryCreator = false
    @State private var systemSharePayload: SystemSharePayload?
    
    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: DSSpacing.lg) {
                        // Title header
                        VStack(spacing: DSSpacing.xxs) {
                            Text("story_share.sheet.title")
                                .font(DSType.displayMedium)
                                .foregroundStyle(DSColor.textPrimary)
                            Text("story_share.sheet.subtitle")
                                .font(DSType.bodyMedium)
                                .foregroundStyle(DSColor.textSecondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, DSSpacing.md)
                        }
                        .padding(.top, DSSpacing.md)

                        // Pre-rendered card preview
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 420)
                            .clipShape(RoundedRectangle(cornerRadius: DSRadius.xxl, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: DSRadius.xxl, style: .continuous)
                                    .strokeBorder(DSColor.border, lineWidth: 1)
                            )
                            .shadow(color: DSColor.inkSurface.opacity(0.25), radius: 20, x: 0, y: 12)
                            .padding(.horizontal, DSSpacing.lg)

                        // Interaction CTAs
                        VStack(spacing: DSSpacing.sm) {
                            // Primary Native Linkfit Story button
                            Button {
                                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                                showStoryCreator = true
                            } label: {
                                HStack(spacing: DSSpacing.xs) {
                                    Image(systemName: "plus.circle.fill")
                                    Text("story_share.action.linkfit_story")
                                }
                                .font(DSType.button)
                                .foregroundStyle(DSColor.textOnAccent)
                                .frame(maxWidth: .infinity)
                                .frame(height: 52)
                                .background(
                                    Capsule()
                                        .fill(DSColor.accent)
                                        .shadow(color: DSColor.accent.opacity(0.3), radius: 10, y: 4)
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text("story_share.action.linkfit_story"))
                            
                            // Secondary system sharing button
                            Button {
                                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                systemSharePayload = SystemSharePayload(image: image)
                            } label: {
                                HStack(spacing: DSSpacing.xs) {
                                    Image(systemName: "square.and.arrow.up")
                                    Text("story_share.action.system_share")
                                }
                                .font(DSType.button)
                                .foregroundStyle(DSColor.textPrimary)
                                .frame(maxWidth: .infinity)
                                .frame(height: 52)
                                .background(
                                    Capsule().fill(DSColor.surfaceElevated)
                                )
                                .overlay(
                                    Capsule().strokeBorder(DSColor.border, lineWidth: 1)
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text("story_share.action.system_share"))
                        }
                        .padding(.horizontal, DSSpacing.lg)
                        .padding(.top, DSSpacing.xs)
                    }
                    .padding(.bottom, DSSpacing.lg)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .fontWeight(.semibold)
                    }
                    .accessibilityLabel(Text("common.close"))
                }
            }
            .sheet(item: $systemSharePayload) { payload in
                ActivityShareSheet(items: [payload.image])
                    .ignoresSafeArea()
            }
            .fullScreenCover(isPresented: $showStoryCreator) {
                StoryCreator(
                    viewModel: StoryCreatorViewModel(
                        apiClient: container.apiClient,
                        initialImage: image,
                        onPosted: { story in
                            showStoryCreator = false
                            dismiss() // Dismiss this preview sheet as well on success!
                        }
                    ),
                    onDismiss: { showStoryCreator = false }
                )
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(.ultraThinMaterial)
    }
}

private struct SystemSharePayload: Identifiable {
    let id = UUID()
    let image: UIImage
}

private struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
