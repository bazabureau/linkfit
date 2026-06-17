import SwiftUI

/// Small status pill. Sentence case, 11pt heavy (no uppercase).
public struct Badge: View {
    public enum Style { case accent, lime, success, warning, danger, neutral }

    private let text: LocalizedStringKey
    private let style: Style

    public init(_ text: LocalizedStringKey, style: Style = .neutral) {
        self.text = text
        self.style = style
    }

    public var body: some View {
        Text(text)
            .font(DSFont.micro)
            .foregroundStyle(foreground)
            .padding(.horizontal, DSSpacing.sm)
            .padding(.vertical, DSSpacing.xxs)
            .background(Capsule().fill(background))
    }

    private var foreground: Color {
        switch style {
        case .accent: return DSColor.accent
        case .lime: return DSColor.courtInk
        case .success: return DSColor.success
        case .warning: return DSColor.warning
        case .danger: return DSColor.danger
        case .neutral: return DSColor.textMuted
        }
    }

    private var background: Color {
        switch style {
        case .accent: return DSColor.accentMuted
        case .lime: return DSColor.lime
        case .success: return DSColor.success.opacity(0.15)
        case .warning: return DSColor.warning.opacity(0.15)
        case .danger: return DSColor.danger.opacity(0.15)
        case .neutral: return DSColor.surface2
        }
    }
}

#Preview {
    HStack {
        Badge("2 spots", style: .accent)
        Badge("Confirmed", style: .success)
        Badge("VIP", style: .lime)
        Badge("Cancelled", style: .danger)
    }
    .padding()
    .background(DSColor.canvas)
}
