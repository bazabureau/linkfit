import SwiftUI

/// Inbox for game invitations directed at the current user. Lists pending
/// rows with Accept/Decline CTAs and an embedded game-preview card so the
/// invitee can decide without leaving the screen.
/// Redesigned to be exceptionally clean, premium, and startup-grade.
struct InvitationsView: View {
    @State var viewModel: InvitationsViewModel

    var body: some View {
        ZStack {
            AppGlassBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: DSSpacing.md) {
                    header
                        .padding(.top, DSSpacing.md)
                    content
                    Spacer().frame(height: 120)
                }
                .padding(.horizontal, DSSpacing.md)
            }
            .refreshable { await viewModel.load() }
        }
        .task { await viewModel.load() }
        .overlay(alignment: .bottom) {
            if let err = viewModel.actionError {
                Text(err)
                    .font(.system(.footnote, design: .default, weight: .bold))
                    .foregroundStyle(DSColor.textOnAccent)
                    .padding(.horizontal, DSSpacing.md)
                    .padding(.vertical, DSSpacing.sm)
                    .background(Capsule().fill(DSColor.danger))
                    .padding(.bottom, DSSpacing.lg)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }

    private var header: some View {
        Text("invitations.subtitle")
            .font(.system(.footnote, design: .default, weight: .bold))
            .foregroundStyle(DSColor.textSecondary)
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView(label: String(localized: "invitations.loading"))
                .frame(height: 220)
        case .empty:
            EmptyStateView(
                icon: "envelope.open",
                title: String(localized: "invitations.empty.title"),
                message: String(localized: "invitations.empty.message")
            )
            .frame(height: 320)
        case .error(let message):
            ErrorStateView(message: message) { Task { await viewModel.load() } }
                .frame(height: 320)
        case .loaded(let items):
            LazyVStack(spacing: 12) {
                ForEach(items) { inv in
                    InvitationRow(
                        invitation: inv,
                        isBusy: viewModel.pendingRowIds.contains(inv.id),
                        onAccept: {
                            UISelectionFeedbackGenerator().selectionChanged()
                            Task { _ = await viewModel.accept(inv) }
                        },
                        onDecline: {
                            UISelectionFeedbackGenerator().selectionChanged()
                            Task { await viewModel.decline(inv) }
                        }
                    )
                }
            }
        }
    }
}

// MARK: - Row

struct InvitationRow: View {
    let invitation: GameInvitation
    let isBusy: Bool
    let onAccept: () -> Void
    let onDecline: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.sm) {
            invitedByHeader
            previewCard
            actionRow
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(DSColor.surfaceElevated)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1)
        )
    }

    private var invitedByHeader: some View {
        HStack(spacing: DSSpacing.sm) {
            ZStack {
                Circle().fill(DSColor.accent.opacity(0.08))
                Circle().strokeBorder(DSColor.accent.opacity(0.18), lineWidth: 1.5)
                Image(systemName: "envelope.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(DSColor.accent)
            }
            .frame(width: 32, height: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(String(format: String(localized: "invitations.invited_by_format"),
                            invitation.inviter_display_name))
                    .font(.system(.footnote, design: .default, weight: .bold))
                    .foregroundStyle(DSColor.textPrimary)
                Text(InvitationFormatting.timeAgo(invitation.created_at))
                    .font(.system(.caption, design: .default, weight: .bold))
                    .foregroundStyle(DSColor.textTertiary)
            }
            Spacer()
        }
    }

    private var previewCard: some View {
        HStack(spacing: DSSpacing.sm) {
            // Glowing sport icon medallion
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(LinearGradient(colors: [DSColor.accent.opacity(0.16), DSColor.accentSoft.opacity(0.04)], startPoint: .topLeading, endPoint: .bottomTrailing))
                Image(systemName: sportIcon(for: invitation.game.sport_slug))
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(DSColor.accent)
            }
            .frame(width: 52, height: 52)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(DSColor.accent.opacity(0.2), lineWidth: 1)
            )

            VStack(alignment: .leading, spacing: 4) {
                Text(invitation.game.sport_slug.capitalized)
                    .font(.system(.subheadline, design: .default, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                Label(InvitationFormatting.dateAndTime(invitation.game.starts_at),
                      systemImage: "calendar")
                    .font(.system(.caption, design: .default, weight: .bold))
                    .foregroundStyle(DSColor.textSecondary)
                if let venue = invitation.game.venue_name {
                    Label(venue, systemImage: "mappin.and.ellipse")
                        .font(.system(.caption, design: .default, weight: .bold))
                        .foregroundStyle(DSColor.textTertiary)
                        .lineLimit(1)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(invitation.game.participants_count)/\(invitation.game.capacity)")
                    .font(.system(.footnote, design: .default, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                Text("invitations.seats_short")
                    .font(.system(.caption2, design: .default, weight: .bold))
                    .foregroundStyle(DSColor.textTertiary)
            }
        }
        // Flattened: previously a surface-filled inner card, which nested a
        // card background inside the outer row card (banned). Plain row +
        // divider keeps the grouping without the double-card look.
        .padding(.vertical, DSSpacing.xs)
        .overlay(alignment: .bottom) {
            Divider().overlay(DSColor.border.opacity(0.3))
        }
    }

    private var actionRow: some View {
        HStack(spacing: 12) {
            Button(action: onDecline) {
                HStack(spacing: 4) {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .bold))
                    Text("invitations.action.decline")
                }
                .font(.system(size: 14, weight: .heavy, design: .default))
                .foregroundStyle(DSColor.textSecondary)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(
                    Capsule()
                        .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1.5)
                        .background(DSColor.surfaceElevated)
                )
            }
            .buttonStyle(SpringButtonStyle())
            .disabled(isBusy)

            Button(action: onAccept) {
                HStack(spacing: 4) {
                    if isBusy {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "checkmark")
                            .font(.system(size: 13, weight: .bold))
                    }
                    Text("invitations.action.accept")
                }
                .font(.system(size: 14, weight: .heavy, design: .default))
                .foregroundStyle(DSColor.textOnAccent)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(
                    Capsule()
                        .fill(DSColor.accent)
                )
            }
            .buttonStyle(SpringButtonStyle())
            .disabled(isBusy)
        }
    }

    private func sportIcon(for slug: String) -> String {
        switch slug {
        case "padel":      return "tennisball.fill"
        case "tennis":     return "tennis.racket"
        case "football_5", "football": return "sportscourt"
        case "basketball": return "basketball.fill"
        default:           return "figure.run"
        }
    }
}

// MARK: - Spring Button Style

struct SpringButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

// MARK: - Date formatting

enum InvitationFormatting {
    static func date(from iso: String) -> Date? {
        let primary = ISO8601DateFormatter()
        primary.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = primary.date(from: iso) { return d }
        let fallback = ISO8601DateFormatter()
        return fallback.date(from: iso)
    }

    static func dateAndTime(_ iso: String) -> String {
        guard let d = date(from: iso) else { return iso }
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f.string(from: d)
    }

    static func timeAgo(_ iso: String) -> String {
        guard let d = date(from: iso) else { return "" }
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f.localizedString(for: d, relativeTo: Date())
    }
}
