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
                    VStack(spacing: 24) {
                        // Title header
                        VStack(spacing: 6) {
                            Text("story_share.sheet.title")
                                .font(.system(size: 22, weight: .heavy))
                                .foregroundStyle(DSColor.textPrimary)
                            Text("story_share.sheet.subtitle")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(DSColor.textSecondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 20)
                        }
                        .padding(.top, 16)

                        // Pre-rendered card preview
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 420)
                            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 24, style: .continuous)
                                    .strokeBorder(DSColor.border, lineWidth: 1)
                            )
                            .shadow(color: .black.opacity(0.25), radius: 20, x: 0, y: 12)
                            .padding(.horizontal, 28)
                        
                        // Interaction CTAs
                        VStack(spacing: 12) {
                            // Primary Native Linkfit Story button
                            Button {
                                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                                showStoryCreator = true
                            } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: "plus.circle.fill")
                                    Text("story_share.action.linkfit_story")
                                }
                                .font(.system(size: 15, weight: .heavy))
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
                            
                            // Secondary system sharing button
                            Button {
                                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                systemSharePayload = SystemSharePayload(image: image)
                            } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: "square.and.arrow.up")
                                    Text("story_share.action.system_share")
                                }
                                .font(.system(size: 15, weight: .heavy))
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
                        }
                        .padding(.horizontal, 28)
                        .padding(.top, 8)
                    }
                    .padding(.bottom, 24)
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
        .presentationDragIndicator(.visible)
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
