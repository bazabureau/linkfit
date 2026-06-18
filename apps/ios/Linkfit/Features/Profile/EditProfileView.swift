import SwiftUI
import MapKit
import PhotosUI
import CoreLocation

struct EditProfileView: View {
    @State var viewModel: EditProfileViewModel
    var onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @FocusState private var focusedField: Field?
    @State private var pickedItem: PhotosPickerItem?
    @State private var pendingCrop: PendingCropImage?
    @State private var resolvedAddress: String = ""
    @State private var mapPosition: MapCameraPosition = .automatic
    @StateObject private var locationManager = LocationOneShotManager()

    static let geocoder = AddressGeocoder()

    private enum Field {
        case displayName
    }

    var body: some View {
        NavigationStack {
            ZStack {
                AppGlassBackground()

                ScrollView {
                    VStack(spacing: 14) {
                        if let message = viewModel.formError {
                            errorBanner(message)
                        }

                        photoRow
                        identitySection
                        locationSection

                        Spacer(minLength: 24)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 28)
                }
                .scrollDismissesKeyboard(.interactively)
                .scrollIndicators(.hidden)
            }
            .navigationTitle(Text("edit_profile.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("common.cancel") {
                        UISelectionFeedbackGenerator().selectionChanged()
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        save()
                    } label: {
                        if viewModel.isSubmitting {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Text("common.save")
                                .font(.system(size: 16, weight: .semibold))
                        }
                    }
                    .disabled(!viewModel.canSubmit)
                }

                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("common.done") { focusedField = nil }
                }
            }
            .task {
                if viewModel.hasLocation {
                    syncMapToCurrentCoordinate()
                    await updateResolvedAddress()
                }
            }
            .fullScreenCover(item: $pendingCrop) { pending in
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
                            guard let data = cropped.jpegData(compressionQuality: 0.9) else { return }
                            await viewModel.setPhoto(from: data)
                        }
                    }
                )
            }
        }
    }

    // MARK: - Sections

    private var photoRow: some View {
        let preview = avatarPreviewImage
        let remoteURL = avatarURL
        let avatarInitials = initials
        let processing = viewModel.isProcessingPhoto
        let hasPhoto = !viewModel.photoUrl.isEmpty

        return settingsSection {
            HStack(spacing: 14) {
                PhotosPicker(selection: $pickedItem, matching: .images, photoLibrary: .shared()) {
                    HStack(spacing: 14) {
                        ProfileAvatarEditor(
                            preview: preview,
                            remoteURL: remoteURL,
                            initials: avatarInitials,
                            processing: processing,
                            size: 76
                        )

                        VStack(alignment: .leading, spacing: 5) {
                            Text("edit_profile.field.photo")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(DSColor.textPrimary)

                            Text("edit_profile.photo.subtitle")
                                .font(.system(size: 13))
                                .foregroundStyle(DSColor.textSecondary)
                                .lineLimit(2)

                            Label(
                                hasPhoto
                                    ? "edit_profile.photo.replace"
                                    : "edit_profile.photo.choose",
                                systemImage: "photo"
                            )
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(DSColor.accent)
                            .padding(.top, 2)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("edit_profile.avatar.change"))
                .onChange(of: pickedItem) { _, newValue in
                    handlePickedItem(newValue)
                }

                if hasPhoto {
                    Button(role: .destructive) {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        viewModel.clearPhoto()
                        pickedItem = nil
                    } label: {
                        Image(systemName: "trash")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(DSColor.danger)
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(DSColor.danger.opacity(0.08)))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("edit_profile.photo.remove"))
                }
            }
        }
    }

    private var identitySection: some View {
        settingsSection(titleKey: "edit_profile.section.identity", icon: "person.text.rectangle") {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 12) {
                    Image(systemName: "person.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(DSColor.textSecondary)
                        .frame(width: 22)

                    TextField(
                        "",
                        text: $viewModel.displayName,
                        prompt: Text("edit_profile.field.display_name.placeholder")
                            .foregroundStyle(DSColor.textTertiary)
                    )
                    .focused($focusedField, equals: .displayName)
                    .textContentType(.name)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled(false)
                    .font(.system(size: 17))
                    .foregroundStyle(DSColor.textPrimary)
                }
                .padding(.horizontal, 14)
                .frame(minHeight: 52)
                .background(
                    RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                        .fill(DSColor.surfaceElevated)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                        .strokeBorder(
                            focusedField == .displayName ? DSColor.accent : DSColor.border,
                            lineWidth: focusedField == .displayName ? 1.5 : 1
                        )
                )
                .accessibilityLabel(Text("edit_profile.field.display_name"))
                .accessibilityHint(Text("a11y.display_name.hint"))

                Text("edit_profile.field.display_name.helper")
                    .font(.system(size: 12))
                    .foregroundStyle(DSColor.textTertiary)
                    .padding(.horizontal, 4)
            }
        }
    }

    private var locationSection: some View {
        settingsSection(titleKey: "edit_profile.section.home_location", icon: "location") {
            VStack(alignment: .leading, spacing: 14) {
                Toggle(isOn: hasLocationBinding) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("edit_profile.location.toggle.title")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(DSColor.textPrimary)

                        Text(viewModel.hasLocation
                             ? "edit_profile.location.enabled_hint"
                             : "edit_profile.location.off_hint")
                            .font(.system(size: 13))
                            .foregroundStyle(DSColor.textSecondary)
                            .lineLimit(3)
                    }
                }
                .tint(DSColor.accent)

                if viewModel.hasLocation {
                    locationMap

                    HStack(spacing: 10) {
                        Image(systemName: "mappin.and.ellipse")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(DSColor.accent)
                            .frame(width: 24)

                        VStack(alignment: .leading, spacing: 2) {
                            Text("edit_profile.location.selected")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(DSColor.textTertiary)
                            if resolvedAddress.isEmpty {
                                Text("edit_profile.location.home_pin")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(DSColor.textPrimary)
                                    .lineLimit(2)
                            } else {
                                Text(resolvedAddress)
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(DSColor.textPrimary)
                                    .lineLimit(2)
                            }
                        }

                        Spacer(minLength: 8)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                            .fill(DSColor.surfaceElevated)
                    )

                    Button {
                        UISelectionFeedbackGenerator().selectionChanged()
                        requestCurrentLocation()
                    } label: {
                        Label("edit_profile.location.use_current", systemImage: "location.fill")
                            .font(.system(size: 14, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(DSColor.accent)
                    .background(
                        RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                            .fill(DSColor.accent.opacity(0.08))
                    )
                    .accessibilityHint(Text("edit_profile.location.use_current.hint"))
                }
            }
        }
    }

    // MARK: - Location

    private var hasLocationBinding: Binding<Bool> {
        Binding(
            get: { viewModel.hasLocation },
            set: { enabled in
                withAnimation(.spring(response: 0.3, dampingFraction: 0.86)) {
                    viewModel.hasLocation = enabled
                }
                if enabled {
                    syncMapToCurrentCoordinate()
                    reverseGeocode()
                } else {
                    resolvedAddress = ""
                }
            }
        )
    }

    private var locationMap: some View {
        let center = currentCoordinate

        return MapReader { proxy in
            Map(position: $mapPosition) {
                Annotation(String(localized: "edit_profile.location.home_pin"), coordinate: center) {
                    ZStack {
                        Circle()
                            .fill(DSColor.accent.opacity(0.24))
                            .frame(width: 34, height: 34)
                        Circle()
                            .fill(DSColor.accent)
                            .frame(width: 16, height: 16)
                            .overlay(Circle().strokeBorder(DSColor.textOnAccent, lineWidth: 2))
                    }
                }
            }
            .frame(height: 160)
            .clipShape(RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                    .strokeBorder(DSColor.border, lineWidth: 1)
            )
            .overlay(alignment: .bottomLeading) {
                Text("edit_profile.location.map_hint")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(DSColor.textPrimary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(.thinMaterial, in: Capsule())
                    .padding(10)
            }
            .onTapGesture { tapPoint in
                guard let coord = proxy.convert(tapPoint, from: .local) else { return }
                setHomeCoordinate(coord)
            }
        }
    }

    private var currentCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: viewModel.homeLat, longitude: viewModel.homeLng)
    }

    private func region(for coordinate: CLLocationCoordinate2D) -> MKCoordinateRegion {
        MKCoordinateRegion(
            center: coordinate,
            span: MKCoordinateSpan(latitudeDelta: 0.025, longitudeDelta: 0.025)
        )
    }

    private func syncMapToCurrentCoordinate() {
        mapPosition = .region(region(for: currentCoordinate))
    }

    private func setHomeCoordinate(_ coordinate: CLLocationCoordinate2D) {
        viewModel.homeLat = coordinate.latitude
        viewModel.homeLng = coordinate.longitude
        mapPosition = .region(region(for: coordinate))
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        reverseGeocode()
    }

    private func requestCurrentLocation() {
        locationManager.requestOnce { coord in
            guard let coord else { return }
            setHomeCoordinate(coord)
        }
    }

    private func reverseGeocode() {
        Task { await updateResolvedAddress() }
    }

    private func updateResolvedAddress() async {
        let label = await Self.geocoder.label(for: viewModel.homeLat, lng: viewModel.homeLng)
        resolvedAddress = label
    }

    // MARK: - Shared UI

    private func settingsSection<Content: View>(
        titleKey: LocalizedStringKey? = nil,
        icon: String? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if let titleKey, let icon {
                HStack(spacing: 10) {
                    Image(systemName: icon)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(DSColor.accent)
                        .frame(width: 28, height: 28)
                        .background(Circle().fill(DSColor.accent.opacity(0.10)))

                    Text(titleKey)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(DSColor.textPrimary)

                    Spacer()
                }
            }

            content()
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .fill(DSColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .strokeBorder(DSColor.border, lineWidth: 1)
        )
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 14, weight: .semibold))
            Text(message)
                .font(.system(size: 13, weight: .medium))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .foregroundStyle(DSColor.danger)
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.md, style: .continuous)
                .fill(DSColor.danger.opacity(0.08))
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

    private func handlePickedItem(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            guard
                let data = try? await item.loadTransferable(type: Data.self),
                let image = UIImage(data: data)
            else {
                return
            }
            pendingCrop = PendingCropImage(image: image)
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

private struct PendingCropImage: Identifiable {
    let id = UUID()
    let image: UIImage
}

private struct ProfileAvatarEditor: View {
    let preview: UIImage?
    let remoteURL: URL?
    let initials: String
    let processing: Bool
    var size: CGFloat = 76

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            avatar
                .frame(width: size, height: size)
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(DSColor.border, lineWidth: 1))

            Image(systemName: "camera.fill")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(DSColor.textOnAccent)
                .frame(width: 28, height: 28)
                .background(Circle().fill(DSColor.accent))
                .overlay(Circle().strokeBorder(DSColor.surface, lineWidth: 2))
        }
        .frame(width: size + 4, height: size + 4)
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
                DSColor.inkSurface.opacity(0.42)
                ProgressView()
                    .controlSize(.small)
                    .tint(DSColor.textOnAccent)
            }
        }
    }

    private var initialsView: some View {
        Text(initials)
            .font(.system(size: max(24, size * 0.36), weight: .bold))
            .foregroundStyle(DSColor.accent)
    }
}
