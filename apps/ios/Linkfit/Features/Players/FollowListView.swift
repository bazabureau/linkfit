import SwiftUI

/// Whether we're showing the followers OR the following list for a given
/// user. Drives the screen title and which endpoint the view model hits.
enum FollowListKind: String, Hashable {
    case followers
    case following

    var titleKey: LocalizedStringKey {
        switch self {
        case .followers: return "follow.followers"
        case .following: return "follow.following"
        }
    }

    var emptyTitleKey: String.LocalizationValue {
        switch self {
        case .followers: return "follow.empty.followers.title"
        case .following: return "follow.empty.following.title"
        }
    }

    var emptyMessageKey: String.LocalizationValue {
        switch self {
        case .followers: return "follow.empty.followers.message"
        case .following: return "follow.empty.following.message"
        }
    }
}

/// Paginated list of users from a follow edge — works for both followers and
/// following lists. Embedded inside a NavigationStack by the caller (sheet,
/// push, etc.); the view itself only manages its own toolbar items.
struct FollowListView: View {
    @State var viewModel: FollowListViewModel
    /// Tapping a row hands the user id back to the host so it can route to
    /// the profile via whatever navigation primitive the host already owns.
    let onPickUser: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(AppContainer.self) private var container

    private var isMe: Bool {
        viewModel.userId == container.currentUser?.id
    }

    var body: some View {
        ZStack {
            PremiumAuthBackground()
            content
        }
        .navigationTitle(Text(viewModel.kind.titleKey))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(DSColor.textPrimary)
                        .padding(8)
                        .background(Circle().fill(Color.white.opacity(0.04)))
                }
                .accessibilityLabel(Text("common.close"))
            }
        }
        .task { await viewModel.onAppear() }
        .refreshable { await viewModel.refresh() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            ScrollView {
                SkeletonView(shape: .avatar, count: 8)
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
            }
            .scrollDisabled(true)
        case .empty:
            premiumEmptyState
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.refresh() } }
        case .loaded(let items):
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(items) { edge in
                        row(edge)
                            .onAppear {
                                // Trigger pagination just before we hit the last row.
                                if edge.id == items.last?.id {
                                    Task { await viewModel.loadMore() }
                                }
                            }
                    }
                    if viewModel.isPaging {
                        ProgressView()
                            .controlSize(.regular)
                            .tint(DSColor.accent)
                            .padding(.vertical, 16)
                    }
                    Spacer().frame(height: 80)
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)
            }
        }
    }

    private var premiumEmptyState: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.12))
                    .frame(width: 72, height: 72)
                Circle()
                    .strokeBorder(DSColor.accent.opacity(0.35), lineWidth: 1)
                    .frame(width: 72, height: 72)
                Image(systemName: "person.crop.circle.badge.plus")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            
            VStack(spacing: 4) {
                Text(emptyTitleKey)
                    .font(.system(size: 17, weight: .heavy, design: .default))
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                Text("empty.follows.body")
                    .font(.system(size: 14, weight: .regular, design: .default))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .padding(.horizontal, 8)
            }
            
            Button {
                UISelectionFeedbackGenerator().selectionChanged()
                dismiss()
            } label: {
                Text("empty.follows.cta")
                    .font(.system(size: 13, weight: .heavy))
                    .foregroundStyle(DSColor.textOnAccent)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 11)
                    .background(Capsule().fill(DSColor.accent))
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color.white.opacity(0.02))
                .background(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        )
        .padding(.horizontal, 16)
        .padding(.top, 60)
    }

    private var emptyTitleKey: LocalizedStringKey {
        switch viewModel.kind {
        case .followers: return "empty.follows.followers.title"
        case .following: return "empty.follows.following.title"
        }
    }

    private func row(_ edge: FollowEdge) -> some View {
        HStack(spacing: 14) {
            HStack(spacing: 12) {
                avatar(for: edge)
                
                VStack(alignment: .leading, spacing: 4) {
                    Text(edge.display_name)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(DSColor.textPrimary)
                        .lineLimit(1)
                    
                    Text(relativeFollowedAt(edge.followed_at))
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(DSColor.textSecondary)
                }
                
                Spacer(minLength: 8)
            }
            .contentShape(Rectangle())
            .onTapGesture {
                UISelectionFeedbackGenerator().selectionChanged()
                onPickUser(edge.id)
            }
            
            let isCurrentViewer = edge.id == container.currentUser?.id
            
            if isCurrentViewer {
                Color.clear.frame(width: 1, height: 30)
            } else if viewModel.kind == .followers && isMe {
                Button {
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    Task {
                        try? await viewModel.removeFollower(followerId: edge.id)
                    }
                } label: {
                    Text(String(localized: "follow.action.remove", defaultValue: "Remove"))
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(DSColor.textSecondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(Color.white.opacity(0.04)))
                        .overlay(Capsule().strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
                }
                .buttonStyle(.plain)
            } else {
                FollowButton(
                    isFollowing: Binding(
                        get: { FollowStore.shared.isFollowing(userId: edge.id) },
                        set: { FollowStore.shared.setFollowing(userId: edge.id, isFollowing: $0) }
                    ),
                    size: .compact
                ) { willFollow in
                    if willFollow {
                        _ = try await container.apiClient.send(Endpoint<EmptyResponse>.followUser(id: edge.id))
                        FollowStore.shared.applyCountDelta(forUser: edge.id, delta: 1)
                        if let currentUserId = container.currentUser?.id {
                            FollowStore.shared.applyCountDelta(forUser: currentUserId, delta: 1)
                        }
                    } else {
                        _ = try await container.apiClient.send(Endpoint<EmptyResponse>.unfollowUser(id: edge.id))
                        FollowStore.shared.applyCountDelta(forUser: edge.id, delta: -1)
                        if let currentUserId = container.currentUser?.id {
                            FollowStore.shared.applyCountDelta(forUser: currentUserId, delta: -1)
                        }
                    }
                }
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.white.opacity(0.02))
                .background(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    private func avatar(for edge: FollowEdge) -> some View {
        let url: URL? = {
            guard let raw = edge.photo_url, !raw.hasPrefix("data:") else { return nil }
            return URL(string: raw)
        }()
        
        return ZStack {
            if let url {
                CachedAsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initialsCircle(for: edge)
                }
            } else {
                initialsCircle(for: edge)
            }
        }
        .frame(width: 44, height: 44)
        .clipShape(Circle())
        .overlay(Circle().stroke(Color.white.opacity(0.12), lineWidth: 1))
    }

    private func initialsCircle(for edge: FollowEdge) -> some View {
        ZStack {
            Circle()
                .fill(LinearGradient(
                    colors: [DSColor.accent.opacity(0.6), DSColor.accent.opacity(0.3)],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                ))
            Text(initials(edge.display_name))
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
        }
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        return parts.joined().isEmpty ? "?" : parts.joined()
    }

    private func relativeFollowedAt(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = formatter.date(from: iso)
        if date == nil {
            formatter.formatOptions = [.withInternetDateTime]
            date = formatter.date(from: iso)
        }
        guard let d = date else { return iso }
        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .short
        let tmpl = String(localized: "follow.followed_at_format")
        return String(format: tmpl, relative.localizedString(for: d, relativeTo: Date()))
    }
}
