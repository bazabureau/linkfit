import SwiftUI
import MapKit
import PhotosUI
import CoreLocation

struct EditProfileView: View {
    @State var viewModel: EditProfileViewModel
    var onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(LanguageManager.self) private var language
    @FocusState private var focusedField: Field?
    @State private var pickedItem: PhotosPickerItem?
    /// Holds a freshly picked image while the circular crop editor is on
    /// screen. `nil` means "no crop pending" — we use the `item:` form of
    /// `.fullScreenCover` so presentation and dismissal are bound to this
    /// state in one place.
    @State private var pendingCrop: PendingCropImage?
    /// Human-readable address derived from the picked coordinates so
    /// the user sees "Yasamal, Bakı" rather than "40.4093, 49.8671".
    @State private var resolvedAddress: String = ""
    @StateObject private var locationManager = LocationOneShotManager()

    /// Shared reverse-geocoder. `AddressGeocoder` is `@unchecked
    /// Sendable`, so the static `let` is concurrency-safe without
    /// the `nonisolated(unsafe)` annotation.
    static let geocoder = AddressGeocoder()

    private enum Field {
        case displayName
    }

    var body: some View {
        NavigationStack {
            ZStack {
                // Clean canvas + soft brand glow — matches the rebuilt tabs
                // and the Oyun yarat sheet; drops the animated auth mesh.
                DSColor.background.ignoresSafeArea()
                RadialGradient(
                    colors: [DSColor.accent.opacity(0.06), .clear],
                    center: .topTrailing, startRadius: 10, endRadius: 360
                )
                .ignoresSafeArea()
                .allowsHitTesting(false)

                ScrollView {
                    VStack(spacing: 16) {
                        photoCard
                        identityCard
                        locationCard
                        languageCard
                        Spacer().frame(height: 120)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                }
                .scrollDismissesKeyboard(.interactively)
                .scrollIndicators(.hidden)
            }
            .navigationTitle(Text("edit_profile.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        UISelectionFeedbackGenerator().selectionChanged()
                        dismiss()
                    } label: {
                        Text("common.cancel")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(DSColor.textSecondary)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 6)
                            .background(
                                Capsule().fill(DSColor.surfaceElevated)
                            )
                            .overlay(
                                Capsule().strokeBorder(DSColor.border, lineWidth: 1)
                            )
                    }
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("common.done") { focusedField = nil }
                }
            }
            .safeAreaInset(edge: .bottom) { bottomSaveBar }
            .fullScreenCover(item: $pendingCrop) { pending in
                // Reusable circular-crop editor. We hand it the raw picked
                // UIImage; on confirm we re-encode to JPEG and feed it back
                // into the same `setPhoto(from:)` pipeline that the picker
                // used to call directly — so the upload-progress ring on the
                // avatar still fires exactly once during the post-crop save.
                PhotoCropView(
                    image: pending.image,
                    onCancel: {
                        pendingCrop = nil
                        pickedItem = nil
                    },
                    onConfirm: { cropped in
                        pendingCrop = nil
                        pickedItem = nil
                        Task {
                            // PhotoCropView already outputs an 800x800 square,
                            // but `setPhoto(from:)` is the canonical entry
                            // point: it runs its own downscale + JPEG encode
                            // on a background task and toggles
                            // `isProcessingPhoto` for the spinner overlay.
                            guard let data = cropped.jpegData(compressionQuality: 0.9) else { return }
                            await viewModel.setPhoto(from: data)
                        }
                    }
                )
            }
        }
    }

    private var photoCard: some View {
        let preview = avatarPreviewImage
        let remote = avatarURL
        let avatarInitials = initials
        let processing = viewModel.isProcessingPhoto
        let hasPhoto = !viewModel.photoUrl.isEmpty

        return VStack(spacing: 18) {
            // Tappable avatar editor — keeps the existing
            // `ProfileAvatarEditor` because it handles the upload
            // overlay (camera badge + spinner) better than anything
            // we'd reinvent here.
            PhotosPicker(selection: $pickedItem, matching: .images, photoLibrary: .shared()) {
                ProfileAvatarEditor(
                    preview: preview,
                    remoteURL: remote,
                    initials: avatarInitials,
                    processing: processing
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("edit_profile.avatar.change"))
            .onChange(of: pickedItem) { _, newValue in
                guard let newValue else { return }
                // Load the raw bytes, then hand the decoded UIImage to the
                // shared `PhotoCropView` for a circular crop. The crop view's
                // `onConfirm` is the path that actually populates the avatar
                // (via `setPhoto(from:)` — same code path as before, keeping
                // the existing upload progress UI intact).
                Task {
                    guard
                        let data = try? await newValue.loadTransferable(type: Data.self),
                        let image = UIImage(data: data)
                    else { return }
                    pendingCrop = PendingCropImage(image: image)
                }
            }

            VStack(spacing: 6) {
                Text(viewModel.trimmedDisplayName.isEmpty
                     ? String(localized: "edit_profile.hero.name_placeholder")
                     : viewModel.trimmedDisplayName)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(DSColor.textPrimary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)

                Text("edit_profile.hero.subtitle")
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(DSColor.textSecondary)
                    .multilineTextAlignment(.center)
            }

            // Premium photo controls — primary "choose/replace" pill
            // on the left, destructive icon button on the right.
            HStack(spacing: 10) {
                PhotosPicker(selection: $pickedItem, matching: .images, photoLibrary: .shared()) {
                    HStack(spacing: 8) {
                        Image(systemName: "photo.on.rectangle.angled")
                            .font(.system(size: 14, weight: .bold))
                        Text(hasPhoto ? "edit_profile.photo.replace" : "edit_profile.photo.choose")
                            .font(.system(size: 14, weight: .bold))
                    }
                    .foregroundStyle(DSColor.textOnAccent)
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .background(
                        Capsule().fill(DSColor.accent)
                    )
                }
                .buttonStyle(.plain)

                if hasPhoto {
                    Button(role: .destructive) {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        viewModel.clearPhoto()
                        pickedItem = nil
                    } label: {
                        Image(systemName: "trash.fill")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(DSColor.danger)
                            .frame(width: 46, height: 46)
                            .background(Capsule().fill(DSColor.danger.opacity(0.08)))
                            .overlay(Capsule().strokeBorder(DSColor.danger.opacity(0.24), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("edit_profile.photo.remove"))
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(DSColor.surface)
                .shadow(color: Color.black.opacity(0.015), radius: 8, x: 0, y: 4)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
    }

    private var identityCard: some View {
        formCard(titleKey: "edit_profile.section.identity", icon: "person.text.rectangle") {
            VStack(alignment: .leading, spacing: 8) {
                FloatingTextField(
                    labelKey: "edit_profile.field.display_name",
                    icon: "person.fill",
                    text: $viewModel.displayName,
                    contentType: .name,
                    autocapitalization: .words
                )
                // FloatingTextField surfaces only its visible label
                // ("Display name") to VoiceOver. The helper line
                // below is visible but isn't tied to the field, so
                // we add it as an explicit hint here.
                .accessibilityHint(Text("a11y.display_name.hint"))

                Text("edit_profile.field.display_name.helper")
                    .font(.system(.caption, design: .default))
                    .foregroundStyle(DSColor.textTertiary)
                    .padding(.horizontal, 4)
            }
        }
    }

    private var locationCard: some View {
        formCard(titleKey: "edit_profile.section.home_location", icon: "location") {
            VStack(alignment: .leading, spacing: 16) {
                Toggle(isOn: $viewModel.hasLocation.animation(.spring(response: 0.32, dampingFraction: 0.82))) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("edit_profile.location.toggle")
                            .font(.system(.subheadline, design: .default, weight: .semibold))
                            .foregroundStyle(DSColor.textPrimary)
                        Text(viewModel.hasLocation ? "edit_profile.location.home_pin" : "edit_profile.location.off_hint")
                            .font(.system(.caption, design: .default))
                            .foregroundStyle(DSColor.textSecondary)
                    }
                }
                .tint(DSColor.accent)

                if viewModel.hasLocation {
                    // Interactive map. Tap anywhere on the map to drop
                    // the pin; gestures (pan, zoom) are unblocked. The
                    // raw lat/lng text fields the user complained about
                    // are gone — coordinates are now a *background
                    // implementation detail* the API sees, never the UI.
                    locationMap

                    // Resolved human-readable label below the map so the
                    // user can verify their pick at a glance instead of
                    // squinting at numbers.
                    if !resolvedAddress.isEmpty {
                        HStack(spacing: 8) {
                            Image(systemName: "mappin.and.ellipse")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(DSColor.accent)
                            Text(resolvedAddress)
                                .font(.system(size: 13, weight: .semibold, design: .default))
                                .foregroundStyle(DSColor.textPrimary)
                                .lineLimit(2)
                        }
                    }

                    // "Use my current location" — one-tap convenience.
                    // The actual GPS permission + fetch lives on the
                    // helper at the bottom of this file so the view
                    // body stays declarative.
                    Button {
                        UISelectionFeedbackGenerator().selectionChanged()
                        requestCurrentLocation()
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: locationManager.isAuthorized ? "location.fill" : "location")
                                .font(.system(size: 14, weight: .bold))
                            Text("edit_profile.location.use_current")
                                .font(.system(size: 14, weight: .bold))
                        }
                        .foregroundStyle(DSColor.accent)
                        .frame(maxWidth: .infinity)
                        .frame(height: 46)
                        .background(
                            Capsule().fill(DSColor.accent.opacity(0.08))
                        )
                        .overlay(
                            Capsule().strokeBorder(DSColor.accent.opacity(0.24), lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint(Text("edit_profile.location.use_current.hint"))
                }
            }
        }
    }

    /// Interactive map — tap to drop pin. `MapReader` exposes a
    /// `proxy.convert(_:from:)` that turns a screen point into a
    /// coordinate, which we then push into the view-model.
    private var locationMap: some View {
        let center = CLLocationCoordinate2D(
            latitude: viewModel.homeLat,
            longitude: viewModel.homeLng
        )
        return MapReader { proxy in
            Map(initialPosition: .region(MKCoordinateRegion(
                center: center,
                span: MKCoordinateSpan(latitudeDelta: 0.025, longitudeDelta: 0.025)
            ))) {
                Annotation(String(localized: "edit_profile.location.home_pin"),
                           coordinate: center) {
                    ZStack {
                        Circle()
                            .fill(DSColor.accent.opacity(0.30))
                            .frame(width: 28, height: 28)
                        Circle()
                            .fill(DSColor.accent)
                            .frame(width: 16, height: 16)
                            .overlay(Circle().strokeBorder(DSColor.textOnAccent, lineWidth: 2))
                    }
                }
            }
            .frame(height: 200)
            .clipShape(RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                    .strokeBorder(DSColor.border, lineWidth: 1)
            )
            .onTapGesture { tapPoint in
                guard let coord = proxy.convert(tapPoint, from: .local) else { return }
                viewModel.homeLat = coord.latitude
                viewModel.homeLng = coord.longitude
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                reverseGeocode()
            }
        }
    }

    private func requestCurrentLocation() {
        locationManager.requestOnce { coord in
            guard let coord else { return }
            viewModel.homeLat = coord.latitude
            viewModel.homeLng = coord.longitude
            reverseGeocode()
        }
    }

    private func reverseGeocode() {
        let lat = viewModel.homeLat
        let lng = viewModel.homeLng
        Task {
            let label = await Self.geocoder.label(for: lat, lng: lng)
            await MainActor.run { resolvedAddress = label }
        }
    }

    private var languageCard: some View {
        formCard(titleKey: "settings.language", icon: "globe") {
            Picker(String(localized: "settings.language"), selection: Bindable(language).current) {
                ForEach(AppLanguage.allCases) { lang in
                    Text(lang.displayKey).tag(lang)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    /// Bottom-anchored save bar — same `PrimaryAuthButton` used on every
    /// auth + create flow so the global "submit a form" affordance feels
    /// identical no matter where the user lands.
    private var bottomSaveBar: some View {
        VStack(spacing: 10) {
            if let message = viewModel.formError ?? viewModel.validationMessage {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 12, weight: .bold))
                    Text(message)
                        .font(.system(.footnote, design: .default, weight: .medium))
                }
                .foregroundStyle(DSColor.danger)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
            }

            PrimaryButton(
                title: String(localized: "common.save"),
                isLoading: viewModel.isSubmitting,
                isEnabled: viewModel.canSubmit
            ) {
                save()
            }
            .padding(.horizontal, 16)
        }
        .padding(.top, 12)
        .padding(.bottom, 20)
        .background(DSColor.surface)
        .overlay(
            Divider().background(DSColor.border),
            alignment: .top
        )
    }

    /// Premium glass section card. Replaces the old solid-surface card with
    /// the design-system pattern: ultraThinMaterial blur + faint border +
    /// lime-tinted icon medallion. Keeps the existing API so call sites
    /// (`identityCard`, `locationCard`, `languageCard`) don't need to change.
    private func formCard<Content: View>(
        titleKey: LocalizedStringKey,
        icon: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(DSColor.accent.opacity(0.08))
                        .frame(width: 34, height: 34)
                    Image(systemName: icon)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(DSColor.accent)
                }
                Text(titleKey)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(DSColor.textPrimary)
                Spacer()
            }

            content()
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(DSColor.surface)
                .shadow(color: Color.black.opacity(0.015), radius: 8, x: 0, y: 4)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
    }

    private func save() {
        focusedField = nil
        Task {
            if await viewModel.submit() {
                onSaved()
                dismiss()
            }
        }
    }

    private var avatarPreviewImage: UIImage? {
        let raw = viewModel.photoUrl
        guard !raw.isEmpty else { return nil }
        if raw.hasPrefix("data:"),
           let comma = raw.firstIndex(of: ","),
           let bytes = Data(base64Encoded: String(raw[raw.index(after: comma)...])) {
            return UIImage(data: bytes)
        }
        return nil
    }

    private var avatarURL: URL? {
        let raw = viewModel.photoUrl
        guard !raw.isEmpty, !raw.hasPrefix("data:") else { return nil }
        return URL(string: raw)
    }

    private var initials: String {
        let parts = viewModel.trimmedDisplayName
            .split(separator: " ")
            .prefix(2)
            .map { $0.prefix(1).uppercased() }
        let joined = parts.joined()
        return joined.isEmpty ? "L" : joined
    }
}

/// Identifiable wrapper so `.fullScreenCover(item:)` can drive the crop
/// presentation. A fresh `UUID` per pick guarantees the cover *re-presents*
/// even if the user picks the same UIImage twice in a row.
private struct PendingCropImage: Identifiable {
    let id = UUID()
    let image: UIImage
}

private struct ProfileAvatarEditor: View {
    let preview: UIImage?
    let remoteURL: URL?
    let initials: String
    let processing: Bool

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            avatar
                .frame(width: 104, height: 104)
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(DSColor.border, lineWidth: 1))
                .shadow(color: Color.black.opacity(0.10), radius: 14, y: 7)

            Image(systemName: "camera.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(DSColor.textOnAccent)
                .frame(width: 32, height: 32)
                .background(Circle().fill(DSColor.accent))
                .overlay(Circle().strokeBorder(DSColor.surface, lineWidth: 2))
        }
    }

    @ViewBuilder
    private var avatar: some View {
        ZStack {
            DSColor.surfaceElevated

            if let preview {
                Image(uiImage: preview)
                    .resizable()
                    .scaledToFill()
            } else if let remoteURL {
                CachedAsyncImage(url: remoteURL) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    initialsView
                }
            } else {
                initialsView
            }

            if processing {
                Color.black.opacity(0.42)
                ProgressView().tint(.white)
            }
        }
    }

    private var initialsView: some View {
        Text(initials)
            .font(.system(size: 34, weight: .bold, design: .default))
            .foregroundStyle(DSColor.accent)
    }
}

