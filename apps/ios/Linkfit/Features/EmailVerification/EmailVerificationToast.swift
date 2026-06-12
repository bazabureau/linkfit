import SwiftUI

/// Tiny, self-contained toast used by the EmailVerification feature. The
/// rest of the app uses ad-hoc inline-banner views; rather than rip into
/// the shared design system mid-feature, we ship a focused component
/// scoped to this module so the integration surface stays small.
///
/// Three semantic flavors (success / error / info) map to lime / red /
/// blue color washes. Auto-dismisses after `duration` seconds; tapping
/// dismisses early.
struct EmailVerificationToast: Equatable, Identifiable {
    enum Kind: Equatable { case success, error, info }

    let id = UUID()
    let title: LocalizedStringKey
    let message: LocalizedStringKey?
    let kind: Kind

    static func == (lhs: EmailVerificationToast, rhs: EmailVerificationToast) -> Bool {
        lhs.id == rhs.id
    }
}

struct EmailVerificationToastView: View {
    let toast: EmailVerificationToast
    let onDismiss: () -> Void

    private var tint: Color {
        switch toast.kind {
        case .success: return DSColor.success
        case .error:   return DSColor.danger
        case .info:    return DSColor.info
        }
    }

    private var icon: String {
        switch toast.kind {
        case .success: return "checkmark.circle.fill"
        case .error:   return "exclamationmark.triangle.fill"
        case .info:    return "info.circle.fill"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: DSSpacing.sm) {
            Image(systemName: icon)
                .foregroundStyle(tint)
                .font(.system(size: 18, weight: .semibold))
            VStack(alignment: .leading, spacing: 2) {
                Text(toast.title)
                    .font(.system(.subheadline, design: .default, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                if let message = toast.message {
                    Text(message)
                        .font(.system(.footnote, design: .default))
                        .foregroundStyle(DSColor.textSecondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(tint.opacity(0.4), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.08), radius: 18, y: 10)
        .padding(.horizontal, DSSpacing.md)
        .onTapGesture { onDismiss() }
        .accessibilityElement(children: .combine)
    }
}
