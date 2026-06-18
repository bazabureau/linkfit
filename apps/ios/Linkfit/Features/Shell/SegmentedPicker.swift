import SwiftUI

/// Custom segmented picker used inside the Play and Discover shells. Pill
/// background, beautifully animated sliding active indicator capsule with brand-accent fill.
struct SegmentedPicker<T: Hashable>: View {
    let segments: [(value: T, label: String, systemImage: String?)]
    @Binding var selection: T
    @Namespace private var pickerNamespace

    var body: some View {
        HStack(spacing: 0) {
            ForEach(segments, id: \.value) { seg in
                let active = seg.value == selection
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    withAnimation(.spring(response: 0.30, dampingFraction: 0.78)) {
                        selection = seg.value
                    }
                } label: {
                    HStack(spacing: 8) {
                        if let icon = seg.systemImage {
                            Image(systemName: icon)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(active ? DSColor.textOnAccent : DSColor.textSecondary)
                        }
                        Text(seg.label)
                            .font(.system(size: 13, weight: .heavy))
                            .lineLimit(1)
                            .foregroundStyle(active ? DSColor.textOnAccent : DSColor.textSecondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 32)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                    .background {
                        if active {
                            RoundedRectangle(cornerRadius: 11, style: .continuous)
                                .fill(DSColor.accent)
                                .matchedGeometryEffect(id: "activeSegmentCapsule", in: pickerNamespace)
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(seg.label)
                .accessibilityAddTraits(active ? [.isButton, .isSelected] : .isButton)
            }
        }
        .padding(4)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous).fill(DSColor.surfaceElevated)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(DSColor.border.opacity(0.3), lineWidth: 1)
        )
    }
}
