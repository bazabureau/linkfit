import SwiftUI

/// App-wide transient message center. Inject one via `.environment` so any
/// feature can call `toasts.show(...)`; host it once with `.toastHost(_:)`.
@MainActor
@Observable
public final class ToastCenter {
    public enum Style: Sendable { case success, error, info }

    public struct Toast: Identifiable, Equatable, Sendable {
        public let id = UUID()
        public let message: String
        public let style: Style
    }

    public private(set) var current: Toast?

    public init() {}

    public func show(_ message: String, style: Style = .info) {
        let toast = Toast(message: message, style: style)
        current = toast
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_600_000_000)
            if self?.current?.id == toast.id { self?.current = nil }
        }
    }

    public func dismiss() { current = nil }
}

private struct ToastView: View {
    let toast: ToastCenter.Toast

    var body: some View {
        HStack(spacing: DSSpacing.m) {
            Image(systemName: iconName)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(tint)
            Text(toast.message)
                .font(DSFont.bodySemibold)
                .foregroundStyle(DSColor.textPrimary)
                .lineLimit(2)
        }
        .padding(.horizontal, DSSpacing.l)
        .padding(.vertical, DSSpacing.m)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.button, style: .continuous)
                .fill(DSColor.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.button, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
        .dsLiftShadow()
        .padding(.horizontal, DSSpacing.xl)
    }

    private var iconName: String {
        switch toast.style {
        case .success: return "checkmark.circle.fill"
        case .error: return "exclamationmark.circle.fill"
        case .info: return "info.circle.fill"
        }
    }

    private var tint: Color {
        switch toast.style {
        case .success: return DSColor.success
        case .error: return DSColor.danger
        case .info: return DSColor.accent
        }
    }
}

public extension View {
    /// Overlays the current toast at the bottom with a slide/fade transition.
    func toastHost(_ center: ToastCenter) -> some View {
        overlay(alignment: .bottom) {
            if let toast = center.current {
                ToastView(toast: toast)
                    .padding(.bottom, DSSpacing.jumbo)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .id(toast.id)
            }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: center.current)
    }
}
