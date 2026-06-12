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
                // Sleek premium dark gradient background
                LinearGradient(
                    colors: [
                        Color(red: 0.1, green: 0.11, blue: 0.15),
                        Color(red: 0.05, green: 0.05, blue: 0.07)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
                
                ScrollView {
                    VStack(spacing: 24) {
                        // Title header
                        VStack(spacing: 6) {
                            Text("Hekayəni Paylaş")
                                .font(.system(size: 22, weight: .black, design: .rounded))
                                .foregroundStyle(.white)
                            Text("Dostlarınla uğurlarını bölüşmək üçün format seç")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(.white.opacity(0.6))
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 20)
                        }
                        .padding(.top, 16)
                        
                        // Gorgeous pre-rendered card preview
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 420)
                            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 24, style: .continuous)
                                    .strokeBorder(Color.white.opacity(0.12), lineWidth: 1.5)
                            )
                            .shadow(color: .black.opacity(0.45), radius: 20, x: 0, y: 12)
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
                                    Text("Linkfit Hekayədə Paylaş")
                                }
                                .font(.system(size: 16, weight: .heavy, design: .rounded))
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
                                    Image(systemName: "square.and.arrow.up.fill")
                                    Text("Digər Tətbiqlərdə Paylaş")
                                }
                                .font(.system(size: 16, weight: .heavy, design: .rounded))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                                .frame(height: 52)
                                .background(
                                    Capsule()
                                        .strokeBorder(Color.white.opacity(0.15), lineWidth: 1.5)
                                        .background(Color.white.opacity(0.06))
                                )
                                .shadow(color: .black.opacity(0.15), radius: 8, x: 0, y: 4)
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
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 30, height: 30)
                            .background(Color.white.opacity(0.08), in: Circle())
                    }
                    .buttonStyle(.plain)
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
