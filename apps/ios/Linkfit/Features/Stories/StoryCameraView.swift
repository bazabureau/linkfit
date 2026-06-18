import SwiftUI
@preconcurrency import AVFoundation
import Photos
import PhotosUI
import UIKit

/// Instagram / Snap–style camera-first viewfinder for the story creator.
///
/// Wave-12: replaces the legacy two-button chooser (`PhotosPicker` +
/// `UIImagePickerController` sheet) with a full-screen `AVCaptureSession`
/// preview. The user lands here when they tap the rail's `+` badge — they
/// can shoot straight away, swap to the library, flip cameras, or close.
///
/// Layout (matches the IG story creator brief):
///
/// ```
///   ┌────────────────────────────────────┐
///   │ ✕                          ⚡ ⏱   │   <- top chrome (close / flash / timer)
///   │                                    │
///   │                                    │
///   │           live preview             │   <- AVCaptureVideoPreviewLayer
///   │                                    │
///   │                                    │
///   │  [📷]      ◯ capture        🔄    │   <- bottom chrome
///   └────────────────────────────────────┘
/// ```
///
/// Architecture choices:
///   * `AVCaptureSession` lives in a small `@MainActor`-isolated
///     coordinator (`StoryCameraController`) so SwiftUI doesn't reach
///     into AVFoundation directly. The `UIViewRepresentable`
///     (`StoryCameraPreview`) hosts the `AVCaptureVideoPreviewLayer`
///     in a UIView.
///   * Permission gating is done up-front in `body` — if `.denied` or
///     `.restricted` we render a permission overlay with a Settings
///     deep-link button instead of starting the session.
///   * The session is started in `.task` and stopped in `.onDisappear`
///     so we don't drain battery while the creator is dismissed but
///     still cached in memory.
///   * Photo capture is delegated to a one-shot
///     `AVCapturePhotoCaptureDelegate` that bounces the resulting
///     `UIImage` back to `onCaptured`.
///
/// We intentionally do NOT implement the timer (clock icon is a
/// non-interactive placeholder) — that's a follow-up wave. Flash is a
/// 3-state toggle (off / on / auto). Flip swaps front/back inputs in
/// place without tearing down the session, so the preview just fades.
struct StoryCameraView: View {
    /// Invoked when the user captures a photo or picks one from the
    /// library. The host wires this to `viewModel.didPickImage(_:)`.
    let onCaptured: (UIImage) -> Void
    /// Invoked when the user taps the close button.
    let onDismiss: () -> Void

    @State private var controller = StoryCameraController()
    @State private var permissionStatus: AVAuthorizationStatus = AVCaptureDevice.authorizationStatus(for: .video)
    @State private var libraryThumbnail: UIImage?
    @State private var pickerItem: PhotosPickerItem?
    @State private var showLibraryPicker: Bool = false
    @State private var isCapturing: Bool = false

    /// When Reduce Motion is on we drop the capture-button fill
    /// transition so the shutter feedback is instant.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch permissionStatus {
            case .authorized:
                cameraStack
            case .notDetermined:
                // Show the preview frame (black) while we ask. Requesting
                // here (vs. inside `.task`) keeps the prompt tied to a
                // user-initiated surface — they tapped "+ Story", they
                // expect a permission dialog right after.
                Color.black.ignoresSafeArea()
                    .task {
                        let granted = await AVCaptureDevice.requestAccess(for: .video)
                        permissionStatus = granted ? .authorized : .denied
                    }
            case .denied, .restricted:
                permissionOverlay
            @unknown default:
                permissionOverlay
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(true)
        .onChange(of: pickerItem) { _, newValue in
            guard let newValue else { return }
            Task {
                if let data = try? await newValue.loadTransferable(type: Data.self),
                   let image = UIImage(data: data) {
                    onCaptured(image)
                }
                pickerItem = nil
            }
        }
        // Photos library picker — used by the bottom-left thumbnail
        // shortcut. We still expose the standard PhotosPicker UX rather
        // than rolling our own grid; mirrors the legacy library flow so
        // permission semantics & accessibility stay consistent.
        .photosPicker(
            isPresented: $showLibraryPicker,
            selection: $pickerItem,
            matching: .images,
            photoLibrary: .shared()
        )
        .task {
            await loadLibraryThumbnail()
        }
    }

    // MARK: - Camera stack

    private var cameraStack: some View {
        ZStack {
            if controller.isSimulator {
                SimulatorViewfinder(controller: controller)
            } else {
                StoryCameraPreview(controller: controller)
                    .ignoresSafeArea()
                    .task {
                        await controller.start()
                    }
                    .onDisappear {
                        controller.stop()
                    }
            }

            // Top chrome — close (left), flash + timer placeholder (right).
            VStack {
                HStack {
                    chromeButton(systemName: "xmark", a11y: "stories.camera.close.a11y") {
                        onDismiss()
                    }
                    Spacer()
                    HStack(spacing: 14) {
                        chromeButton(
                            systemName: controller.flashMode.iconName,
                            a11y: "stories.camera.flash.a11y"
                        ) {
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            controller.cycleFlashMode()
                        }
                        // Timer placeholder — non-interactive icon for now
                        // (skipped per W12-1 brief). Lower opacity so it
                        // visually reads as "future control" rather than
                        // an active button.
                        Image(systemName: "timer")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.5))
                            .frame(width: 36, height: 36)
                            .background(Color.black.opacity(0.25), in: Circle())
                            .accessibilityHidden(true)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)

                Spacer()
            }

            // Bottom chrome — thumbnail (left), capture (center), flip (right).
            VStack {
                Spacer()
                HStack(alignment: .center) {
                    libraryThumbnailButton
                        .frame(maxWidth: .infinity, alignment: .leading)
                    captureButton
                        .frame(maxWidth: .infinity, alignment: .center)
                    flipButton
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 32)
            }
        }
    }

    // MARK: - Capture button

    private var captureButton: some View {
        Button {
            guard !isCapturing else { return }
            isCapturing = true
            UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
            controller.capturePhoto { image in
                isCapturing = false
                if let image {
                    onCaptured(image)
                }
            }
        } label: {
            ZStack {
                Circle()
                    .strokeBorder(Color.white, lineWidth: 5)
                    .frame(width: 78, height: 78)
                Circle()
                    .fill(isCapturing ? DSColor.accent : Color.white.opacity(0.001))
                    .frame(width: 62, height: 62)
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: isCapturing)
            }
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("stories.creator.action.camera"))
        .accessibilityAddTraits(.isButton)
    }

    // MARK: - Library thumbnail

    private var libraryThumbnailButton: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            showLibraryPicker = true
        } label: {
            Group {
                if let thumb = libraryThumbnail {
                    Image(uiImage: thumb)
                        .resizable()
                        .scaledToFill()
                } else {
                    // Empty-state — keeps the slot occupied so the layout
                    // doesn't jump once PhotoKit returns. A faint photo
                    // icon hints at the affordance for users who've
                    // never granted Photos access.
                    ZStack {
                        Color.white.opacity(0.08)
                        Image(systemName: "photo.on.rectangle")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.7))
                    }
                }
            }
            .frame(width: 44, height: 44)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.85), lineWidth: 1.5)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("edit_profile.photo.choose"))
    }

    // MARK: - Flip

    private var flipButton: some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            Task { await controller.flipCamera() }
        } label: {
            Image(systemName: "arrow.triangle.2.circlepath.camera")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(Color.black.opacity(0.35), in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("stories.camera.flip.a11y"))
    }

    // MARK: - Chrome helpers

    private func chromeButton(systemName: String, a11y: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(Color.black.opacity(0.35), in: Circle())
                // Keep the visible chrome circle at 36pt (camera-app
                // convention) but expand the hit area to the 44pt HIG
                // minimum so the close / flash controls are easy to tap.
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(a11y))
    }

    // MARK: - Permission overlay

    private var permissionOverlay: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 20) {
                Spacer()
                Image(systemName: "camera.slash.fill")
                    .font(.system(size: 56, weight: .light))
                    .foregroundStyle(.white.opacity(0.85))
                Text("stories.camera.permission.title")
                    .font(.system(size: 20, weight: .heavy))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                Text("stories.camera.permission.body")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white.opacity(0.75))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                Button {
                    // Deep-link to the app's permission screen.
                    // `UIApplication.openSettingsURLString` always
                    // resolves to a valid URL on iOS — force-unwrap is
                    // safe and idiomatic here.
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                } label: {
                    Text("stories.camera.permission.cta")
                        .font(.system(size: 15, weight: .heavy))
                        .foregroundStyle(DSColor.textOnAccent)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
                        .background(Capsule().fill(DSColor.accent))
                }
                .buttonStyle(.plain)
                .padding(.top, 8)
                Spacer()
            }
            .overlay(alignment: .topLeading) {
                chromeButton(systemName: "xmark", a11y: "stories.camera.close.a11y") {
                    onDismiss()
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
            }
        }
    }

    // MARK: - Library thumbnail loader

    /// Fetches the most-recent photo from the user's library for the
    /// bottom-left shortcut. We don't ask for full read access here —
    /// `PHPhotoLibrary.authorizationStatus(for: .readWrite)` may be
    /// `.notDetermined`; in that case we just skip the thumbnail and
    /// fall back to the empty-state. The PhotosPicker flow itself
    /// triggers the system prompt when the user actually taps the
    /// thumbnail, so we never need to ask up front.
    private func loadLibraryThumbnail() async {
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else { return }

        let options = PHFetchOptions()
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        options.fetchLimit = 1
        let assets = PHAsset.fetchAssets(with: .image, options: options)
        guard let asset = assets.firstObject else { return }

        let manager = PHImageManager.default()
        let target = CGSize(width: 132, height: 132) // 44pt @ 3x
        let requestOptions = PHImageRequestOptions()
        requestOptions.deliveryMode = .opportunistic
        requestOptions.resizeMode = .fast
        requestOptions.isNetworkAccessAllowed = true

        let image: UIImage? = await withCheckedContinuation { continuation in
            var didResume = false
            manager.requestImage(
                for: asset,
                targetSize: target,
                contentMode: .aspectFill,
                options: requestOptions
            ) { result, info in
                // `requestImage` may invoke the callback twice
                // (degraded preview, then full quality). Only resume
                // on the final, non-degraded delivery.
                let isDegraded = (info?[PHImageResultIsDegradedKey] as? Bool) ?? false
                guard !isDegraded, !didResume else { return }
                didResume = true
                continuation.resume(returning: result)
            }
        }
        await MainActor.run {
            self.libraryThumbnail = image
        }
    }
}

// MARK: - Camera controller

/// `@MainActor`-isolated AVFoundation wrapper. Holds the session, inputs,
/// and the photo output. Exposes a small command surface
/// (`start/stop/flipCamera/cycleFlashMode/capturePhoto`) so the SwiftUI
/// view stays declarative.
///
/// Why `@Observable` (not `@StateObject`) — we only need the
/// `flashMode` to drive the chrome icon; everything else is fire-and-
/// forget. `@Observable` keeps the dependency footprint tiny.
@MainActor
@Observable
final class StoryCameraController {
    /// Flash mode for the next capture. Cycles off → on → auto.
    var flashMode: FlashMode = .off

    enum FlashMode {
        case off, on, auto

        var avMode: AVCaptureDevice.FlashMode {
            switch self {
            case .off: return .off
            case .on: return .on
            case .auto: return .auto
            }
        }

        var iconName: String {
            switch self {
            case .off: return "bolt.slash.fill"
            case .on: return "bolt.fill"
            case .auto: return "bolt.badge.a.fill"
            }
        }

        func next() -> FlashMode {
            switch self {
            case .off: return .on
            case .on: return .auto
            case .auto: return .off
            }
        }
    }

    /// Computed check if there is no physical camera or running on a simulator
    var isSimulator: Bool {
        #if targetEnvironment(simulator)
        return true
        #else
        return bestDevice(for: .back) == nil
        #endif
    }

    /// Shared session. We keep it as `let` so the preview layer can hold
    /// a stable reference; lifecycle is managed via `start/stop`.
    ///
    /// `nonisolated(unsafe)` because `AVCaptureSession` itself isn't
    /// `Sendable`, but the framework documents it as thread-safe — and
    /// we only mutate it on the main actor (config) or on the dedicated
    /// `sessionQueue` (start/stop). The pattern is standard for Swift 6
    /// strict-concurrency AVFoundation code.
    nonisolated(unsafe) let session = AVCaptureSession()
    nonisolated(unsafe) private let photoOutput = AVCapturePhotoOutput()
    private var currentInput: AVCaptureDeviceInput?
    private var currentPosition: AVCaptureDevice.Position = .back
    private var isConfigured = false

    /// Background queue for `start/stopRunning` so we don't block the
    /// main actor while the camera spins up.
    private let sessionQueue = DispatchQueue(label: "az.linkfit.story-camera.session", qos: .userInitiated)

    /// Holds the active `AVCapturePhotoCaptureDelegate` while a capture
    /// is in flight — AVFoundation only weakly retains delegates, so
    /// without this anchor the closure-based delegate would be released
    /// before `photoOutput:didFinishProcessingPhoto:` fires.
    private var captureDelegate: PhotoCaptureDelegate?

    // MARK: Lifecycle

    /// Configures (once) and starts the session. Safe to call repeatedly;
    /// `AVCaptureSession.startRunning()` no-ops if already running.
    func start() async {
        guard !isSimulator else { return }
        if !isConfigured {
            configureSession()
            isConfigured = true
        }
        // `startRunning` blocks — push to the AV queue so we don't
        // stall the main actor while the camera spins up. We hop through
        // a dispatch queue rather than `Task.detached` so the non-Sendable
        // `AVCaptureSession` stays inside a single isolation domain.
        let session = self.session
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            sessionQueue.async {
                if !session.isRunning {
                    session.startRunning()
                }
                continuation.resume()
            }
        }
    }

    func stop() {
        guard !isSimulator else { return }
        let session = self.session
        sessionQueue.async {
            if session.isRunning {
                session.stopRunning()
            }
        }
    }

    private func configureSession() {
        guard !isSimulator else { return }
        session.beginConfiguration()
        // Photo preset gives us full-resolution stills; lower presets
        // (high, 1080p) downscale unnecessarily for a single-shot UI.
        session.sessionPreset = .photo

        // Back camera by default — IG default behaviour.
        if let device = bestDevice(for: .back),
           let input = try? AVCaptureDeviceInput(device: device),
           session.canAddInput(input) {
            session.addInput(input)
            currentInput = input
            currentPosition = .back
        }

        if session.canAddOutput(photoOutput) {
            session.addOutput(photoOutput)
            photoOutput.maxPhotoQualityPrioritization = .quality
        }

        session.commitConfiguration()
    }

    private func bestDevice(for position: AVCaptureDevice.Position) -> AVCaptureDevice? {
        // Prefer the triple/dual virtual devices when available — they
        // give the OS room to pick the best physical lens for the
        // scene. Falls back to the wide-angle device, which exists on
        // every camera-equipped iPhone.
        let types: [AVCaptureDevice.DeviceType] = [
            .builtInTripleCamera,
            .builtInDualWideCamera,
            .builtInDualCamera,
            .builtInWideAngleCamera
        ]
        for type in types {
            if let device = AVCaptureDevice.default(type, for: .video, position: position) {
                return device
            }
        }
        return AVCaptureDevice.default(for: .video)
    }

    // MARK: Commands

    func cycleFlashMode() {
        flashMode = flashMode.next()
    }

    /// Swap front/back. Keeps the session running across the change so
    /// the preview just fades rather than dropping black; we wrap the
    /// reconfiguration in `begin/commitConfiguration` for atomicity.
    func flipCamera() async {
        guard !isSimulator else { return }
        let newPosition: AVCaptureDevice.Position = (currentPosition == .back) ? .front : .back
        guard let newDevice = bestDevice(for: newPosition),
              let newInput = try? AVCaptureDeviceInput(device: newDevice) else {
            return
        }

        session.beginConfiguration()
        if let existing = currentInput {
            session.removeInput(existing)
        }
        if session.canAddInput(newInput) {
            session.addInput(newInput)
            currentInput = newInput
            currentPosition = newPosition
        } else if let existing = currentInput {
            // Re-attach the original if the new input fails — never
            // leave the session input-less.
            session.addInput(existing)
        }
        session.commitConfiguration()
    }

    /// Capture a single still and deliver it via `completion` on the
    /// main actor. Failures (no auth, hardware error) resolve with
    /// `nil` so callers can keep the UI alive without an extra error
    /// channel — the view falls back to its previous state.
    func capturePhoto(completion: @escaping (UIImage?) -> Void) {
        if isSimulator {
            // Simulate camera capture using a gorgeous graphics-rendered image!
            let image = generateMockSimulatorImage()
            completion(image)
            return
        }

        let settings = AVCapturePhotoSettings()
        // Only request a flash mode the active device supports —
        // front-camera-only devices (very old iPads) don't advertise
        // hardware flash, so blindly setting `.on` traps.
        if let device = currentInput?.device, device.hasFlash {
            settings.flashMode = flashMode.avMode
        }

        let delegate = PhotoCaptureDelegate { [weak self] image in
            Task { @MainActor in
                self?.captureDelegate = nil
                completion(image)
            }
        }
        captureDelegate = delegate
        photoOutput.capturePhoto(with: settings, delegate: delegate)
    }

    /// Generates a beautiful startup-grade sports template card image for simulated runs
    private func generateMockSimulatorImage() -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 1080, height: 1920))
        return renderer.image { ctx in
            // Beautiful startup-style dark gradient
            let colors = [
                UIColor(red: 0.1, green: 0.1, blue: 0.12, alpha: 1.0).cgColor,
                UIColor(red: 0.05, green: 0.05, blue: 0.07, alpha: 1.0).cgColor
            ]
            let colorSpace = CGColorSpaceCreateDeviceRGB()
            let gradient = CGGradient(colorsSpace: colorSpace, colors: colors as CFArray, locations: [0.0, 1.0])!
            ctx.cgContext.drawLinearGradient(
                gradient,
                start: CGPoint(x: 540, y: 0),
                end: CGPoint(x: 540, y: 1920),
                options: []
            )
            
            // Draw a subtle grid pattern or tennis/padel lines in the background
            ctx.cgContext.setStrokeColor(UIColor.white.withAlphaComponent(0.04).cgColor)
            ctx.cgContext.setLineWidth(4)
            // Outer court boundary
            ctx.cgContext.stroke(CGRect(x: 100, y: 300, width: 880, height: 1320))
            // Center line
            ctx.cgContext.move(to: CGPoint(x: 540, y: 300))
            ctx.cgContext.addLine(to: CGPoint(x: 540, y: 1620))
            ctx.cgContext.strokePath()
            // Net line
            ctx.cgContext.move(to: CGPoint(x: 100, y: 960))
            ctx.cgContext.addLine(to: CGPoint(x: 980, y: 960))
            ctx.cgContext.strokePath()
            
            // Draw glassmorphic circle in the center
            let circleRect = CGRect(x: 540 - 200, y: 960 - 200, width: 400, height: 400)
            ctx.cgContext.setFillColor(UIColor.white.withAlphaComponent(0.08).cgColor)
            ctx.cgContext.fillEllipse(in: circleRect)
            
            // Lime glow border (matches DSColor.accent)
            ctx.cgContext.setStrokeColor(UIColor(red: 0.74, green: 0.98, blue: 0.0, alpha: 0.35).cgColor)
            ctx.cgContext.setLineWidth(3)
            ctx.cgContext.strokeEllipse(in: circleRect)
            
            // Draw "Linkfit Padel" branding inside
            let textAttributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 42, weight: .black),
                .foregroundColor: UIColor(red: 0.74, green: 0.98, blue: 0.0, alpha: 1.0)
            ]
            let brandStr = "LINKFIT LIVE"
            let brandSize = brandStr.size(withAttributes: textAttributes)
            brandStr.draw(
                at: CGPoint(x: 540 - brandSize.width / 2, y: 960 - brandSize.height / 2 - 20),
                withAttributes: textAttributes
            )
            
            let descAttributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 22, weight: .bold),
                .foregroundColor: UIColor.white.withAlphaComponent(0.6)
            ]
            let descStr = "SIMULATOR CAM"
            let descSize = descStr.size(withAttributes: descAttributes)
            descStr.draw(
                at: CGPoint(x: 540 - descSize.width / 2, y: 960 + brandSize.height / 2),
                withAttributes: descAttributes
            )
            
            // Decorative elements
            let titleAttributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 56, weight: .black),
                .foregroundColor: UIColor.white
            ]
            let titleStr = "Let's Play Padel!"
            let titleSize = titleStr.size(withAttributes: titleAttributes)
            titleStr.draw(
                at: CGPoint(x: 540 - titleSize.width / 2, y: 200),
                withAttributes: titleAttributes
            )
        }
    }
}

// MARK: - Photo capture delegate

/// One-shot delegate wrapping `AVCapturePhotoCaptureDelegate`. AVFoundation
/// keeps a weak reference, so the controller anchors this instance for
/// the duration of the capture.
private final class PhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate {
    private let onFinish: (UIImage?) -> Void

    init(onFinish: @escaping (UIImage?) -> Void) {
        self.onFinish = onFinish
    }

    func photoOutput(_ output: AVCapturePhotoOutput,
                     didFinishProcessingPhoto photo: AVCapturePhoto,
                     error: Error?) {
        if error != nil {
            onFinish(nil)
            return
        }
        guard let data = photo.fileDataRepresentation(),
              let image = UIImage(data: data) else {
            onFinish(nil)
            return
        }
        onFinish(image)
    }
}

// MARK: - Preview

/// UIView-backed host for `AVCaptureVideoPreviewLayer`. SwiftUI can't
/// embed a `CALayer` directly, so we wrap it in a `UIView` whose
/// layerClass is the preview layer — this is the canonical Apple-blessed
/// pattern and gives us free `videoGravity` + auto layer-resizing.
struct StoryCameraPreview: UIViewRepresentable {
    let controller: StoryCameraController

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = controller.session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {
        // Session reference is stable — nothing to update.
    }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer {
            // Force-cast: the runtime layer is always the type returned
            // by `layerClass` above. Apple's own samples use the same
            // pattern.
            // swiftlint:disable:next force_cast
            layer as! AVCaptureVideoPreviewLayer
        }
    }
}

// MARK: - Simulator Viewfinder

struct SimulatorViewfinder: View {
    let controller: StoryCameraController
    
    var body: some View {
        Color.black.ignoresSafeArea()
    }
}
