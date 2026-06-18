import SwiftUI

/// Visual layer for a single toast. Pure presentation — knows nothing about
/// the `ToastCenter` lifecycle; `ToastHost` owns appearance/disappearance.
///
/// Look: rounded glass capsule with a tinted accent border per `Kind`, an
/// SF Symbol icon on the leading edge, message text in `textPrimary`. Sits
/// in safe-area bottom inset, max width clamped on iPad.
///
/// `.errorWithRetry` adds a trailing capsule button "Yenidən cəhd et" that
/// routes through `ToastCenter.performRetry()` — the host doesn't need to
/// thread the closure through, the center already owns it.
struct ToastView: View {
    let toast: Toast
    var onTap: () -> Void = {}
    var onRetry: () -> Void = {}

    var body: some View {
        HStack(alignment: .center, spacing: DSSpacing.sm) {
            Image(systemName: iconName)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(accentColor)
                .accessibilityHidden(true)

            Text(toast.message)
                .font(DSType.bodyEmphasis)
                .foregroundStyle(DSColor.textPrimary)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Inline retry CTA — only for the dedicated kind. Kept inside
            // the pill (rather than as a separate row) so the affordance
            // travels with the toast and is reachable with one thumb.
            if isRetryKind {
                Button(action: onRetry) {
                    Text(String(localized: "error.action.retry"))
                        .font(DSType.metaCaption)
                        .foregroundStyle(DSColor.textPrimary)
                        .padding(.horizontal, DSSpacing.sm)
                        .padding(.vertical, 6)
                        .background(
                            Capsule(style: .continuous)
                                .fill(accentColor.opacity(0.22))
                        )
                        .overlay(
                            Capsule(style: .continuous)
                                .strokeBorder(accentColor.opacity(0.65), lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                // Make sure tapping the button doesn't bubble up to the
                // pill's tap-to-dismiss gesture — the parent tap would
                // race the retry closure and dismiss the toast before the
                // VM ever sees the action.
                .accessibilityLabel(Text(String(localized: "error.action.retry")))
                .accessibilityAddTraits(.isButton)
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .frame(maxWidth: 520, alignment: .leading)
        .background(
            // Glass capsule — material under a translucent surface tint so
            // the toast stays readable over the brand's deep canvas and any
            // photo / hero gradient screens it might overlay.
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .fill(.ultraThinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                        .fill(DSColor.surface.opacity(0.72))
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous)
                .strokeBorder(accentColor.opacity(0.55), lineWidth: 1)
        )
        .shadow(color: DSColor.inkSurface.opacity(0.35), radius: 18, x: 0, y: 10)
        .contentShape(RoundedRectangle(cornerRadius: DSRadius.lg, style: .continuous))
        // Only the non-retry kinds get tap-to-dismiss on the body — for
        // the retry pill, the user's primary interaction is the inline
        // button, and a stray pill tap shouldn't lose the offer.
        .onTapGesture {
            if !isRetryKind { onTap() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(accessibilityPrefix + ": " + toast.message))
    }

    // MARK: - Kind-driven styling

    private var isRetryKind: Bool {
        if case .errorWithRetry = toast.kind { return true }
        return false
    }

    private var iconName: String {
        switch toast.kind {
        case .success:         return "checkmark.circle.fill"
        case .error,
             .errorWithRetry: return "exclamationmark.triangle.fill"
        case .info:            return "info.circle.fill"
        }
    }

    private var accentColor: Color {
        switch toast.kind {
        case .success:         return DSColor.success
        case .error,
             .errorWithRetry: return DSColor.danger
        case .info:            return DSColor.info
        }
    }

    /// Spoken by VoiceOver before the message body so the user understands
    /// the toast's severity. Localized — keys live in Localizable.xcstrings.
    private var accessibilityPrefix: String {
        switch toast.kind {
        case .success:         return String(localized: "toast.a11y.success")
        case .error,
             .errorWithRetry: return String(localized: "toast.a11y.error")
        case .info:            return String(localized: "toast.a11y.info")
        }
    }
}
