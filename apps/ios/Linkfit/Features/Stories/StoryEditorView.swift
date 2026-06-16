import SwiftUI
import UIKit

/// Instagram-style story editor. Sits between the cropper and the
/// caption/composer, letting the user place text/mention/sticker overlays
/// on top of the chosen image with full drag/pinch/rotate gestures.
///
/// **Layout.**
///
/// ```
///   ┌─ closeBtn  ✕                    ⋯ ─┐  (top chrome)
///   │            [Aa] [@] [😀]           │  (tool buttons)
///   │                                    │
///   │            <photo canvas>          │
///   │             • text overlays        │
///   │             • mention overlays     │
///   │             • sticker overlays     │
///   │                                    │
///   │  ┌─ İrəli ─┐                       │
///   └────────────────────────────────────┘
/// ```
///
/// **Coordinate flow.** Overlays persist their position as a normalized
/// `(x, y)` in `[0, 1]` of the canvas. On render we read the canvas's
/// `GeometryReader` size and multiply. On drag we divide back. This
/// keeps the same overlay-on-photo at the same spot across screen sizes
/// AND across rotations (if we ever stop locking to portrait).
///
/// **Gesture composition.** Each overlay attaches three gestures
/// simultaneously: drag (translates `x`/`y`), magnify (multiplies
/// `scale`), rotate (adds to `rotation`). SwiftUI's `.simultaneously(
/// with:)` chains them so a two-finger pinch+twist works in one
/// continuous motion — the same as Instagram. The gesture handlers
/// fold the delta into the persisted value on end, so `gestureScale`
/// etc. only hold the in-flight delta.
struct StoryEditorView: View {
    @Bindable var viewModel: StoryEditorViewModel
    @Environment(\.displayScale) private var displayScale

    // Per-overlay in-flight gesture state. We key by the overlay's id so
    // a freshly-tapped overlay doesn't inherit another overlay's pinch
    // mid-frame. State is reset on gesture end (the committed value
    // lives on the payload itself).
    @State private var dragDeltas: [UUID: CGSize] = [:]
    @State private var scaleDeltas: [UUID: CGFloat] = [:]
    @State private var rotationDeltas: [UUID: Angle] = [:]

    /// Which overlay currently has the highlight ring around it. Tap
    /// outside any overlay → nil → ring disappears. Stored separately
    /// from `editingTextOverlayID` because selection ≠ open-sheet:
    /// double-tap-to-delete uses selection without opening the sheet.
    @State private var selectedID: UUID?

    var body: some View {
        GeometryReader { proxy in
            let canvas = proxy.size

            ZStack {
                // Pitch-black behind so portrait images sit on the same
                // ink as the StoryViewer (and as the picker chooser).
                Color.black.ignoresSafeArea()

                // The photo, fitted into the canvas (preserves aspect).
                // Reads `filteredImage` (not `image`) so the live preview
                // updates whenever the bottom filter strip changes
                // `selectedFilter`. The computed's identity fast-path
                // keeps the no-filter case (Original tile) free.
                Image(uiImage: viewModel.filteredImage)
                    .resizable()
                    .scaledToFit()
                    .frame(width: canvas.width, height: canvas.height)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        // Tapping the bare photo dismisses any selected
                        // overlay (kills the handle ring). Matches IG.
                        selectedID = nil
                    }

                // Overlays in z-order. Render each on top of the photo
                // and attach gestures inline so the closure captures
                // the current `canvas` size for normalisation.
                ForEach(viewModel.overlays) { overlay in
                    overlayView(for: overlay, canvas: canvas)
                }

                // Top + bottom chrome are siblings inside the ZStack so
                // they float above all overlays — even ones the user
                // drags to the corner.
                VStack(spacing: 0) {
                    topToolbar
                        .padding(.horizontal, 12)
                        .padding(.top, 8)
                    Spacer()
                    // Filter strip sits ABOVE the Next button so users
                    // can tweak the filter at the last moment without
                    // hunting up to the toolbar. The strip provides its
                    // own dark gradient background so it reads against
                    // bright photos. We bypass horizontal padding (the
                    // strip owns its own internal `.padding(.horizontal,
                    // 16)`) so the rightmost tile can scroll off-edge
                    // without truncation.
                    StoryFilterStrip(viewModel: viewModel)
                    bottomBar(canvas: canvas)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 16)
                }
            }
            // Sheet for editing a text overlay. Driven off the VM's
            // `editingTextOverlayID` — non-nil means we have a payload
            // to hand the sheet.
            .fullScreenCover(isPresented: textSheetBinding) {
                if let payload = viewModel.editingTextOverlay() {
                    StoryTextEditorSheet(
                        initial: payload,
                        onCommit: { updated in
                            viewModel.updateTextOverlay(updated)
                        },
                        onCancel: {
                            viewModel.cancelTextEdit()
                        }
                    )
                    .presentationBackground(.clear)
                }
            }
            // Confirmation dialog wired off the VM's `pendingDeleteID`.
            .confirmationDialog(
                Text("stories.overlay.delete.confirm"),
                isPresented: deleteBinding,
                titleVisibility: .visible
            ) {
                Button(role: .destructive) {
                    viewModel.confirmDelete()
                    selectedID = nil
                } label: {
                    Text("stories.overlay.delete.action")
                }
                Button(role: .cancel) {
                    viewModel.cancelDelete()
                } label: {
                    Text("common.cancel")
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: - Top toolbar

    /// Top row: close button on the left, tool buttons (text/mention/
    /// sticker) on the right. Mention + sticker buttons come from the
    /// sibling W12-3 and W12-5 files — we reference them by type name so
    /// the integration verifier (W12-6) catches missing types.
    private var topToolbar: some View {
        HStack(spacing: 10) {
            Button {
                viewModel.onClose()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(Color.black.opacity(0.4), in: Circle())
                    // Visible disc stays 36pt, but expand the hit area to
                    // the 44pt HIG minimum so a small thumb still lands.
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("stories.editor.close"))

            Spacer()

            // Text tool — fully owned by this agent. The "Aa" glyph is
            // a literal because the label IS the text-tool affordance
            // and the AZ/EN/RU localisations all render the same two
            // glyphs (the xcstrings key still exists so future locales
            // can override it).
            Button {
                viewModel.addTextOverlay()
            } label: {
                Text("stories.editor.tool.text")
                    .font(.system(size: 18, weight: .heavy))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Color.black.opacity(0.4), in: Circle())
                    // 40pt disc matches the sibling tool buttons; bump the
                    // hit area to 44pt for the HIG minimum tap target.
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("stories.text.tool.label"))

            // Sibling-agent buttons. References-by-type-name so this
            // file fails to build until W12-3 (`MentionToolButton`) and
            // W12-5 (`StickerToolButton`) land — that's the intended
            // coordination dependency (the integration verifier in W12-6
            // catches missing types if either stalls). The buttons each
            // take a `[StoryOverlay]` binding so they can append directly
            // to the canvas list without re-piping through the VM.
            MentionToolButton(overlays: $viewModel.overlays)
            StickerToolButton(overlays: $viewModel.overlays)
            // W13 — pencil-style drawing tool. Same `[StoryOverlay]`
            // binding so the canvas can append a `.drawing(...)`
            // overlay once the user taps "Tamam" inside the modal.
            DrawingToolButton(overlays: $viewModel.overlays)
        }
    }

    // MARK: - Bottom bar

    /// Bottom bar: just the "İrəli" (Next) CTA for now. Future tools
    /// (filters, music) will land in this row.
    private func bottomBar(canvas: CGSize) -> some View {
        HStack {
            Spacer()
            Button {
                Haptics.medium()
                // Burn the overlays into the bitmap so they actually show
                // up in the posted story. With no overlays we keep the bare
                // filtered photo (no letterboxing a plain photo onto black).
                if viewModel.overlays.isEmpty {
                    viewModel.submit()
                } else if let flattened = renderFlattened(canvas: canvas) {
                    viewModel.submitFlattened(flattened)
                } else {
                    viewModel.submit()
                }
            } label: {
                HStack(spacing: 6) {
                    Text("stories.editor.next")
                        .font(DSType.button)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 14, weight: .bold))
                }
                .foregroundStyle(DSColor.textOnAccent)
                .padding(.horizontal, 22)
                .padding(.vertical, 12)
                .background(
                    Capsule()
                        .fill(DSColor.accent)
                        .shadow(color: DSColor.accent.opacity(0.4), radius: 10, y: 4)
                )
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Flatten for upload

    /// One overlay rendered statically — same payload view + transform as
    /// the live editor, but with no selection ring and no gestures. Used
    /// only when compositing the upload bitmap.
    @ViewBuilder
    private func staticOverlayView(for overlay: StoryOverlay, canvas: CGSize) -> some View {
        let position = persistedPosition(for: overlay, canvas: canvas)
        let scale = persistedScale(for: overlay)
        let rotation = persistedRotationAngle(for: overlay)
        Group {
            switch overlay {
            case .text(let payload):    StoryTextOverlayView(overlay: payload)
            case .mention(let payload): StoryMentionOverlayView(overlay: payload, isActive: false)
            case .sticker(let payload): payload.view(isActive: false)
            case .drawing(let payload):
                payload.view(isActive: false)
                    .frame(width: canvas.width, height: canvas.height)
            }
        }
        .scaleEffect(scale)
        .rotationEffect(rotation)
        .position(x: position.x, y: position.y)
    }

    /// Composite the photo (fitted on black) + every overlay into one
    /// bitmap at the on-screen canvas aspect, so overlay positions match
    /// exactly what the user placed. Returns nil if `ImageRenderer` can't
    /// produce an image, in which case the caller falls back to the
    /// un-flattened photo.
    @MainActor
    private func renderFlattened(canvas: CGSize) -> UIImage? {
        let content = ZStack {
            Color.black
            Image(uiImage: viewModel.filteredImage)
                .resizable()
                .scaledToFit()
                .frame(width: canvas.width, height: canvas.height)
            ForEach(viewModel.overlays) { overlay in
                staticOverlayView(for: overlay, canvas: canvas)
            }
        }
        .frame(width: canvas.width, height: canvas.height)
        .environment(\.colorScheme, .dark)

        let renderer = ImageRenderer(content: content)
        renderer.scale = max(displayScale, 2)
        renderer.isOpaque = true
        return renderer.uiImage
    }

    // MARK: - Overlay rendering

    /// One overlay = the rendered payload + handle-ring decoration +
    /// gesture stack. We pull `canvas` in (from the parent's Geometry-
    /// Reader) so the drag handler can divide pixels back into normalized
    /// coordinates.
    @ViewBuilder
    private func overlayView(for overlay: StoryOverlay, canvas: CGSize) -> some View {
        let id = overlay.id
        let isSelected = selectedID == id

        // Committed transform from the payload. We rebuild the gesture
        // numbers by adding the in-flight delta on top.
        let position = persistedPosition(for: overlay, canvas: canvas)
        let liveScale = persistedScale(for: overlay) * (scaleDeltas[id] ?? 1.0)
        let liveRotation = persistedRotationAngle(for: overlay) + (rotationDeltas[id] ?? .zero)
        let liveOffset = dragDeltas[id] ?? .zero

        Group {
            switch overlay {
            case .text(let payload):
                StoryTextOverlayView(overlay: payload)
            case .mention(let payload):
                // Renderer for the mention pill lives in the sibling
                // agent's file. Same coordination pattern as the toolbar
                // buttons — references-by-type-name. The `isActive` flag
                // controls the active-state chrome (dashed border + boosted
                // shadow) so selection chrome stays consistent with text
                // and sticker overlays.
                StoryMentionOverlayView(overlay: payload, isActive: isSelected)
            case .sticker(let payload):
                // Sticker renderer also lives in the sibling file. W12-5
                // exposes it as an extension on the payload (`view(isActive:)`)
                // because the chrome differs between selected and idle.
                payload.view(isActive: isSelected)
            case .drawing(let payload):
                // W13 — finger-drawing overlay. Renders a read-only
                // PKCanvasView sized to the editor canvas so the
                // strokes land in the same spot they were drawn. The
                // payload exposes `view(isActive:)` via an extension
                // (`StoryDrawingOverlay.swift`) so we match the
                // sticker pattern.
                payload.view(isActive: isSelected)
                    .frame(width: canvas.width, height: canvas.height)
            }
        }
        .overlay(
            // Lime handle ring around the selected overlay. Padded out
            // 4pt so it sits OUTSIDE the rendered glyph/pill bounds.
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(
                    DSColor.accent,
                    style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])
                )
                .padding(-4)
                .opacity(isSelected ? 1 : 0)
                .allowsHitTesting(false)
        )
        .scaleEffect(liveScale)
        .rotationEffect(liveRotation)
        .position(x: position.x + liveOffset.width, y: position.y + liveOffset.height)
        .onTapGesture {
            // Single tap = select (show ring) + open the per-overlay
            // edit modal where supported (text → sheet; mention/sticker
            // each handle their own modal via the VM extension points).
            selectedID = id
            viewModel.tapOverlay(id)
        }
        .onTapGesture(count: 2) {
            // Double-tap → confirm-delete. We don't auto-delete because
            // the gesture is easy to fire accidentally with a wide
            // finger over a small overlay.
            Haptics.soft()
            selectedID = id
            viewModel.requestDelete(id)
        }
        .gesture(combinedGesture(for: id, canvas: canvas))
    }

    /// Build the simultaneous drag+pinch+rotate gesture for a single
    /// overlay. We split the closures out so the type inference stays
    /// happy — chained `.simultaneously(with:)` returns a deeply nested
    /// generic type and the compiler bails if everything inlines.
    private func combinedGesture(for id: UUID, canvas: CGSize) -> some Gesture {
        let drag = DragGesture()
            .onChanged { value in
                dragDeltas[id] = value.translation
                if selectedID != id { selectedID = id }
            }
            .onEnded { value in
                commitDrag(value.translation, to: id, canvas: canvas)
                dragDeltas[id] = .zero
            }

        let magnify = MagnificationGesture()
            .onChanged { value in
                scaleDeltas[id] = value
                if selectedID != id { selectedID = id }
            }
            .onEnded { value in
                commitScale(value, to: id)
                scaleDeltas[id] = 1.0
            }

        let rotate = RotationGesture()
            .onChanged { angle in
                rotationDeltas[id] = angle
                if selectedID != id { selectedID = id }
            }
            .onEnded { angle in
                commitRotation(angle, to: id)
                rotationDeltas[id] = .zero
            }

        return drag.simultaneously(with: magnify).simultaneously(with: rotate)
    }

    // MARK: - Persisted transform helpers

    /// Convert the payload's normalized `(x, y)` into a pixel position
    /// for SwiftUI's `.position(x:y:)`.
    private func persistedPosition(for overlay: StoryOverlay, canvas: CGSize) -> CGPoint {
        let (px, py) = normalizedXY(for: overlay)
        return CGPoint(x: px * canvas.width, y: py * canvas.height)
    }

    private func persistedScale(for overlay: StoryOverlay) -> CGFloat {
        switch overlay {
        case .text(let p):    return p.scale
        case .mention(let p): return p.scale
        case .sticker(let p): return p.scale
        case .drawing(let p): return p.scale
        }
    }

    private func persistedRotationAngle(for overlay: StoryOverlay) -> Angle {
        switch overlay {
        case .text(let p):    return .radians(p.rotation)
        case .mention(let p): return .radians(p.rotation)
        case .sticker(let p): return .radians(p.rotation)
        case .drawing(let p): return .radians(p.rotation)
        }
    }

    private func normalizedXY(for overlay: StoryOverlay) -> (CGFloat, CGFloat) {
        switch overlay {
        case .text(let p):    return (p.x, p.y)
        case .mention(let p): return (p.x, p.y)
        case .sticker(let p): return (p.x, p.y)
        case .drawing(let p): return (p.x, p.y)
        }
    }

    // MARK: - Mutating the payloads

    /// Fold the live drag translation back into normalized `(x, y)` and
    /// rewrite the payload in `viewModel.overlays`. Clamps to `[0, 1]`
    /// so a hard fling can't bury the overlay off-screen.
    private func commitDrag(_ translation: CGSize, to id: UUID, canvas: CGSize) {
        guard let index = viewModel.overlays.firstIndex(where: { $0.id == id }) else { return }
        guard canvas.width > 0, canvas.height > 0 else { return }
        let dx = translation.width / canvas.width
        let dy = translation.height / canvas.height
        mutate(overlay: &viewModel.overlays[index]) { x, y, scale, rot in
            (clamp(x + dx, 0, 1), clamp(y + dy, 0, 1), scale, rot)
        }
    }

    /// Multiply the in-flight scale factor into the persisted scale.
    /// Clamp to `[0.4, 5.0]` — anything smaller is unreadable, anything
    /// larger overruns the canvas.
    private func commitScale(_ factor: CGFloat, to id: UUID) {
        guard let index = viewModel.overlays.firstIndex(where: { $0.id == id }) else { return }
        mutate(overlay: &viewModel.overlays[index]) { x, y, scale, rot in
            (x, y, clamp(scale * factor, 0.4, 5.0), rot)
        }
    }

    /// Add the in-flight rotation delta to the persisted rotation.
    private func commitRotation(_ angle: Angle, to id: UUID) {
        guard let index = viewModel.overlays.firstIndex(where: { $0.id == id }) else { return }
        mutate(overlay: &viewModel.overlays[index]) { x, y, scale, rot in
            (x, y, scale, rot + angle.radians)
        }
    }

    /// Rewrite the four `StoryOverlayPayload` transform fields on
    /// whichever case is wrapped. Saves us a switch at every call
    /// site (drag/scale/rotate each only care about one field).
    private func mutate(
        overlay: inout StoryOverlay,
        transform: (CGFloat, CGFloat, CGFloat, Double) -> (CGFloat, CGFloat, CGFloat, Double)
    ) {
        switch overlay {
        case .text(var p):
            let (x, y, s, r) = transform(p.x, p.y, p.scale, p.rotation)
            p.x = x; p.y = y; p.scale = s; p.rotation = r
            overlay = .text(p)
        case .mention(var p):
            let (x, y, s, r) = transform(p.x, p.y, p.scale, p.rotation)
            p.x = x; p.y = y; p.scale = s; p.rotation = r
            overlay = .mention(p)
        case .sticker(var p):
            let (x, y, s, r) = transform(p.x, p.y, p.scale, p.rotation)
            p.x = x; p.y = y; p.scale = s; p.rotation = r
            overlay = .sticker(p)
        case .drawing(var p):
            // W13 — drawing fills the canvas, so in practice the
            // editor's gestures only mutate (x, y, scale, rotation)
            // when a future "shrink and reposition" UX lands. For
            // now we still propagate the transform so the gesture
            // stack stays uniform across every payload variant.
            let (x, y, s, r) = transform(p.x, p.y, p.scale, p.rotation)
            p.x = x; p.y = y; p.scale = s; p.rotation = r
            overlay = .drawing(p)
        }
    }

    private func clamp<T: Comparable>(_ value: T, _ lower: T, _ upper: T) -> T {
        min(max(value, lower), upper)
    }

    // MARK: - Binding helpers

    /// Bridge `editingTextOverlayID: UUID?` ↔ `fullScreenCover(is-
    /// Presented:)`. Setting `false` cancels the edit (drops empty
    /// fresh overlays, leaves existing ones alone).
    private var textSheetBinding: Binding<Bool> {
        Binding(
            get: { viewModel.editingTextOverlayID != nil },
            set: { isPresented in
                if !isPresented { viewModel.cancelTextEdit() }
            }
        )
    }

    /// Bridge `pendingDeleteID: UUID?` ↔ `confirmationDialog(is-
    /// Presented:)`.
    private var deleteBinding: Binding<Bool> {
        Binding(
            get: { viewModel.pendingDeleteID != nil },
            set: { isPresented in
                if !isPresented { viewModel.cancelDelete() }
            }
        )
    }
}
