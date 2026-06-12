import SwiftUI

/// Horizontal "avatars-with-rings" rail that sits on top of HomeView.
///
/// Layout: a `ScrollView(.horizontal)` of round 70pt avatars wrapped in a
/// 2.5pt gradient ring. The first cell is always "Your story" — the
/// viewer's own avatar with a `+` badge in the corner, tappable to open
/// the StoryCreator. Subsequent cells are one per `StoryGroup`, sorted
/// by the backend (newest unviewed → newest viewed). Tap on any group
/// opens the StoryViewer at the first frame.
///
/// Auto-hide: when `viewModel.groups` is empty AND the viewer has no
/// own row to render (which only happens before `didLoad` resolves on
/// cold launch), the rail returns `EmptyView()` so it doesn't render
/// an empty band on home. The viewer-own row is always rendered once
/// we know who the viewer is — even with zero followed users with
/// stories, "Your story +" still acts as the entry point to the
/// creator. This matches Instagram's behavior on a brand-new account.
struct StoriesRail: View {
    @Bindable var viewModel: StoriesRailViewModel
    /// The signed-in user. We need the photo/name for the "Your story"
    /// cell and to identify which row in `groups` (if any) is the
    /// viewer's own (so we don't render them twice — the viewer cell
    /// replaces the duplicate).
    let viewer: PublicUser?
    /// Tapped a non-owner group's cell. The host opens StoryViewer at
    /// the tapped group's first unviewed frame.
    let onOpenGroup: (StoryGroup) -> Void
    /// Tapped the "+" cell (or the viewer's own cell when they have no
    /// stories yet). The host presents StoryCreator.
    let onCreateStory: () -> Void
    /// Tapped the viewer's own cell when they already have stories.
    /// Distinguished from `onOpenGroup` so the host can wire the
    /// viewer's own stack to either the viewer (if any stories) or
    /// the creator (if none). For symmetry with Instagram: tap = view,
    /// long-press = create — but the rail itself stays single-tap and
    /// the long-press handling lives outside this file.
    let onOpenOwnStack: (StoryGroup) -> Void

    var body: some View {
        if !shouldRender {
            EmptyView()
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    // Viewer's own cell — always first. Renders as
                    // either "Your story +" (when they have no stack)
                    // or the gradient-ring avatar over their existing
                    // stack. The `+` badge is always present so the
                    // creator entry point doesn't disappear after the
                    // first post.
                    ownStoryCell

                    // All OTHER groups — skip the viewer's own group
                    // since `ownStoryCell` already represents it. The
                    // viewmodel pre-computes `otherGroups` alongside
                    // every `groups` mutation so this `ForEach` doesn't
                    // re-filter on every render.
                    ForEach(viewModel.otherGroups) { group in
                        StoryRailCell(
                            labelName: group.display_name,
                            displayName: group.display_name,
                            photoUrl: group.photo_url,
                            hasUnviewed: group.has_unviewed,
                            isOwn: false,
                            onTap: { onOpenGroup(group) }
                        )
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }
            .scrollClipDisabled()
            // Hand the viewer id to the view-model so it can derive
            // `otherGroups` server-side of the SwiftUI body. `onChange`
            // covers the cold-launch case where `viewer` resolves
            // asynchronously after the initial render.
            .onAppear { viewModel.setViewerId(viewer?.id) }
            .onChange(of: viewer?.id) { _, newId in
                viewModel.setViewerId(newId)
            }
        }
    }

    // MARK: - Sub-views

    @ViewBuilder
    private var ownStoryCell: some View {
        let ownGroup = viewer.flatMap { v in
            viewModel.groups.first(where: { $0.user_id == v.id })
        }
        StoryRailCell(
            // For "Your story" we always show the literal "Your story"
            // string (localized) rather than the user's name — matches
            // Instagram. When the user already has stories the ring
            // still uses `has_unviewed` from the group so the viewer
            // can see whether their own latest frame has been viewed
            // by others (the server marks viewed_by_me=true for their
            // own frames so the ring goes gray once posted, which
            // mirrors Instagram's "muted ring on your own").
            labelName: nil, // signals "use Your story" label below
            displayName: viewer?.display_name,
            photoUrl: viewer?.photo_url,
            hasUnviewed: ownGroup?.has_unviewed ?? false,
            isOwn: true,
            onTap: {
                if let g = ownGroup {
                    onOpenOwnStack(g)
                } else {
                    onCreateStory()
                }
            },
            onCreateStory: onCreateStory
        )
    }

    /// The rail renders only when:
    ///   * we have a viewer (so "Your story +" can show), AND
    ///   * either we have a viewer (the own-cell is always present)
    ///     OR we've fetched non-empty groups.
    /// In practice this means: hide on cold launch before we know the
    /// viewer; once mounted, always show at least the own-cell. If we
    /// want strict "auto-hide when zero items" semantics later, swap
    /// `viewer != nil` to `!viewModel.groups.isEmpty || hasViewer`.
    private var shouldRender: Bool {
        viewer != nil
    }
}

// MARK: - Cell

/// A single round avatar in the rail. Public-ish (not `private`) so the
/// SwiftUI compiler can synthesize the gesture handler closure without
/// the surrounding ForEach exploding into a generic-monolith. Stays
/// inside this file to keep the rail self-contained.
struct StoryRailCell: View {
    /// `nil` means show the localized "Your story" label.
    let labelName: String?
    let displayName: String?
    let photoUrl: String?
    let hasUnviewed: Bool
    let isOwn: Bool
    let onTap: () -> Void
    var onCreateStory: (() -> Void)? = nil

    /// 70pt avatar inside a 2.5pt gradient ring. The ring is rendered
    /// as a circular `AngularGradient` masked by a stroked Circle so
    /// the gradient sweeps around the rim rather than fading top-to-
    /// bottom. When `hasUnviewed == false` we fall back to a flat
    /// gray ring (Instagram's "viewed" state).
    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 6) {
                ZStack {
                    ring
                    avatarImage
                        .frame(width: 64, height: 64)
                        .clipShape(Circle())
                }
                .frame(width: 74, height: 74)
                .overlay(alignment: .bottomTrailing) {
                    if isOwn, let onCreateStory {
                        // "+" badge in the corner. Always tappable — even when the
                        // user has an existing stack, the badge is the explicit
                        // create entry-point. Hit area is small (24pt) so it
                        // doesn't fight the parent tap; users who want to "open"
                        // tap the avatar, users who want to "create" tap the +.
                        Button(action: onCreateStory) {
                            ZStack {
                                Circle()
                                    .fill(DSColor.accent)
                                    .frame(width: 22, height: 22)
                                Circle()
                                    .strokeBorder(DSColor.background, lineWidth: 2.5)
                                    .frame(width: 22, height: 22)
                                Image(systemName: "plus")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(DSColor.textOnAccent)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("stories.your_story"))
                        // Offset so the badge sits half-on-half-off the ring,
                        // matching Instagram's geometry.
                        .offset(x: 2, y: -4)
                    }
                }

                label
            }
        }
        .buttonStyle(StoryCellButtonStyle())
        .accessibilityLabel(accessibility)
    }

    private var ring: some View {
        Circle()
            .stroke(ringStyle, lineWidth: 2.5)
            .frame(width: 72, height: 72)
    }

    /// Lime-green AngularGradient on unviewed, flat gray on viewed.
    /// Why AngularGradient: a LinearGradient would only show two stops
    /// at the top/bottom of the ring; the angular variant sweeps the
    /// whole rim which is the Instagram look. We use accent (lime) +
    /// accentSoft (deeper green) for the two-stop sweep — both come
    /// from the app's brand palette so the ring matches the rest of
    /// the chrome.
    private var ringStyle: AnyShapeStyle {
        if hasUnviewed {
            return AnyShapeStyle(
                AngularGradient(
                    gradient: Gradient(colors: [
                        DSColor.accent,
                        DSColor.accentSoft,
                        DSColor.accent
                    ]),
                    center: .center,
                    startAngle: .degrees(0),
                    endAngle: .degrees(360)
                )
            )
        } else {
            return AnyShapeStyle(DSColor.border.opacity(0.6))
        }
    }

    @ViewBuilder
    private var avatarImage: some View {
        if !isLogoPlaceholder, let urlStr = photoUrl, let url = URL(string: urlStr) {
            CachedAsyncImage(url: url) { phase in
                if let img = phase.image {
                    img.resizable().scaledToFill()
                } else {
                    initialsAvatar(name: displayName)
                }
            }
        } else {
            initialsAvatar(name: displayName)
        }
    }

    private func initialsAvatar(name: String?) -> some View {
        ZStack {
            Circle()
                .fill(LinearGradient(
                    colors: [DSColor.accent.opacity(0.4), DSColor.accent.opacity(0.15)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))
            Text(initials(from: name))
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .foregroundStyle(DSColor.textPrimary)
        }
    }

    private var isLogoPlaceholder: Bool {
        guard let url = photoUrl else { return true }
        let lower = url.lowercased()
        return lower.contains("logo") || lower.contains("placeholder") || lower.hasPrefix("data:image")
    }

    private func initials(from name: String?) -> String {
        guard let name, !name.isEmpty else { return "L" }
        let parts = name.split(separator: " ").prefix(2).map { $0.prefix(1).uppercased() }
        return parts.joined().isEmpty ? "L" : parts.joined()
    }

    @ViewBuilder
    private var label: some View {
        let text: Text = {
            if let labelName, !isOwn {
                return Text(firstName(labelName))
            } else {
                return Text("stories.your_story")
            }
        }()
        text
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(DSColor.textPrimary)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            .frame(maxWidth: 74)
    }

    private var accessibility: Text {
        if isOwn {
            return Text("stories.your_story")
        } else if let name = displayName {
            return Text(name)
        } else {
            return Text(verbatim: "")
        }
    }

    /// Show only the first name in the rail — matches Instagram and
    /// keeps the 74pt cell width from overflowing on long names.
    private func firstName(_ full: String) -> String {
        full.split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true)
            .first
            .map(String.init) ?? full
    }
}

/// Subtle scale-on-press feedback. Plain Button does no animation; the
/// rail benefits from a touch of "I pressed it" haptic feel before the
/// modal opens.
private struct StoryCellButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
