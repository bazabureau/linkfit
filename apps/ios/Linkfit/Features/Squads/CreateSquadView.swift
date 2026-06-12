import SwiftUI
import PhotosUI

/// Create-Squad form, presented as a sheet from `SquadsListView`.
///
/// Layout (top → bottom):
///   1. Close button + page hero (icon + title + subtitle).
///   2. Photo picker — optional. Picks via `PhotosPicker`; preview tile
///      renders the chosen image with a "Change" affordance.
///   3. Name field — required, 2…50 chars.
///   4. Description field — optional, multi-line.
///   5. Max-size stepper — 2…8, default 4.
///   6. Submit bar pinned to the bottom with a lime PrimaryButton.
struct CreateSquadView: View {
    @State var viewModel: CreateSquadViewModel
    /// Callback fired on a successful create; the parent uses it to
    /// stitch the row into its list and push straight into the new
    /// squad's detail screen.
    var onCreated: (Squad) -> Void

    @Environment(\.dismiss) private var dismiss
    /// Picked image item from the PhotosPicker. Resolved into a UIImage
    /// in `onChange` and handed to the view-model.
    @State private var pickedPickerItem: PhotosPickerItem?
    /// Local mirror of the picked image. We hold this on the view rather
    /// than reading the view-model directly inside the PhotosPicker
    /// label closure — the picker closure is `@Sendable` and can't
    /// reference `@MainActor`-isolated view-model state under Swift 6
    /// strict concurrency.
    @State private var previewImage: UIImage?

    var body: some View {
        ZStack(alignment: .bottom) {
            PremiumAuthBackground()
            ScrollView {
                VStack(spacing: 24) {
                    topBar
                    heroHeader
                    photoSection
                    nameSection
                    descriptionSection
                    sizeSection
                    Spacer().frame(height: 110)
                }
                .padding(.top, 8)
                .padding(.bottom, DSSpacing.xl)
            }
            .scrollDismissesKeyboard(.interactively)
            submitBar
        }
        .onChange(of: pickedPickerItem) { _, newItem in
            // Resolve PhotosPickerItem → UIImage on the main actor.
            // Failures (invalid image, user cancellation) silently keep
            // the previous image — the picker UI handles its own error
            // reporting. Update both `previewImage` (label-binding) and
            // the view-model's photo so the picker UI + submit pipeline
            // stay in sync.
            guard let newItem else { return }
            Task {
                if let data = try? await newItem.loadTransferable(type: Data.self),
                   let image = UIImage(data: data) {
                    previewImage = image
                    viewModel.pickedPhoto = image
                }
            }
        }
    }

    // MARK: - Top bar & hero

    private var topBar: some View {
        HStack {
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(DSColor.textPrimary)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(.ultraThinMaterial))
                    .overlay(Circle().strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("common.close"))
            Spacer()
        }
        .padding(.horizontal, 20)
    }

    private var heroHeader: some View {
        VStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(DSColor.accent.opacity(0.16))
                    .frame(width: 72, height: 72)
                Image(systemName: "person.3.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(DSColor.accent)
            }
            Text("squads.create.title")
                .font(.system(size: 22, weight: .heavy))
                .foregroundStyle(DSColor.textPrimary)
            Text("squads.create.subtitle")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
    }

    // MARK: - Photo

    private var photoSection: some View {
        // PhotosPicker's label closure is `@Sendable` under Swift 6
        // strict concurrency, so reads of `@MainActor`-isolated state
        // can't appear inline inside it. Same pattern as
        // `EditProfileView.photoCard` — bind a local `let` outside the
        // closure so the captured value is plain `UIImage?` rather than
        // a property access against `self`.
        let preview = previewImage
        return sectionShell(titleKey: "squads.field.photo") {
            PhotosPicker(selection: $pickedPickerItem,
                         matching: .images,
                         photoLibrary: .shared()) {
                PhotoPickerLabel(image: preview)
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Name

    private var nameSection: some View {
        sectionShell(titleKey: "squads.field.name") {
            VStack(alignment: .leading, spacing: 6) {
                TextField(text: $viewModel.name) {
                    Text("squads.field.name.placeholder")
                }
                .textInputAutocapitalization(.words)
                .submitLabel(.next)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(DSColor.surface)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(DSColor.border.opacity(0.5), lineWidth: 1)
                )
                Text(String(format: String(localized: "squads.field.name.counter_format"),
                            viewModel.name.count))
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DSColor.textTertiary)
                    .monospacedDigit()
            }
        }
    }

    // MARK: - Description

    private var descriptionSection: some View {
        sectionShell(titleKey: "squads.field.description") {
            ZStack(alignment: .topLeading) {
                if viewModel.description.isEmpty {
                    Text("squads.field.description.placeholder")
                        .font(.system(size: 14))
                        .foregroundStyle(DSColor.textTertiary)
                        .padding(.horizontal, 16)
                        .padding(.top, 14)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $viewModel.description)
                    .font(.system(size: 14))
                    .foregroundStyle(DSColor.textPrimary)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 88)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
            }
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(DSColor.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(DSColor.border.opacity(0.5), lineWidth: 1)
            )
        }
    }

    // MARK: - Size

    private var sizeSection: some View {
        sectionShell(titleKey: "squads.field.max_size") {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text(String(format: String(localized: "squads.field.max_size.value_format"),
                                viewModel.maxSize))
                        .font(.system(size: 18, weight: .heavy))
                        .foregroundStyle(DSColor.textPrimary)
                        .monospacedDigit()
                    Spacer()
                    stepperControl
                }
                Text("squads.field.max_size.hint")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(DSColor.textSecondary)
                    .lineLimit(2)
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(.ultraThinMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1)
            )
        }
    }

    /// +/- pair with the same vocabulary as `CreateGameView`'s custom
    /// stepper — buttons grey out when the bound is reached. Each tap
    /// fires a selection haptic so the press is unambiguous.
    private var stepperControl: some View {
        let canDec = viewModel.maxSize > 2
        let canInc = viewModel.maxSize < 8
        return HStack(spacing: 0) {
            stepButton(systemImage: "minus", enabled: canDec) {
                guard canDec else { return }
                viewModel.maxSize = viewModel.clamp(viewModel.maxSize - 1)
                UISelectionFeedbackGenerator().selectionChanged()
            }
            Rectangle()
                .fill(DSColor.border.opacity(0.4))
                .frame(width: 1, height: 22)
            stepButton(systemImage: "plus", enabled: canInc) {
                guard canInc else { return }
                viewModel.maxSize = viewModel.clamp(viewModel.maxSize + 1)
                UISelectionFeedbackGenerator().selectionChanged()
            }
        }
        .background(Capsule().fill(DSColor.surfaceElevated.opacity(0.6)))
        .overlay(Capsule().strokeBorder(DSColor.border.opacity(0.5), lineWidth: 1))
    }

    private func stepButton(systemImage: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .heavy))
                .foregroundStyle(enabled ? DSColor.accent : DSColor.textTertiary)
                .frame(width: 42, height: 36)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(Text(systemImage == "plus" ? "common.increment" : "common.decrement"))
    }

    // MARK: - Submit

    private var submitBar: some View {
        VStack(spacing: 0) {
            if let err = viewModel.formError {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 12, weight: .bold))
                    Text(err)
                        .font(.system(size: 13, weight: .medium))
                }
                .foregroundStyle(DSColor.danger)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }
            PrimaryButton(
                title: String(localized: "squads.create.submit"),
                icon: "checkmark",
                isLoading: viewModel.isSubmitting,
                isEnabled: viewModel.canSubmit
            ) {
                Task {
                    if let squad = await viewModel.submit() {
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                        onCreated(squad)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 18)
        }
        .background(
            LinearGradient(
                colors: [DSColor.background.opacity(0), DSColor.background],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 160)
            .allowsHitTesting(false),
            alignment: .bottom
        )
    }

    // MARK: - Section shell

    /// Reusable section block — small uppercase microlabel + content.
    /// Same pattern `CreateGameView.sectionShell` uses; lifted here so
    /// the two flows feel like siblings.
    private func sectionShell<Content: View>(
        titleKey: LocalizedStringKey,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(titleKey)
                .font(.system(size: 11, weight: .heavy))
                .foregroundStyle(DSColor.textTertiary)
                .padding(.horizontal, 20)
            content()
                .padding(.horizontal, 16)
        }
    }
}

// MARK: - Photo picker label

/// Value-typed label used inside `PhotosPicker { ... }`. Lives outside
/// `CreateSquadView` so the PhotosPicker's `@Sendable` closure can
/// construct it from any context — strict concurrency forbids
/// referencing the parent view's `@MainActor` computed properties from
/// inside the picker's trailing closure.
///
/// The label takes the currently-picked `UIImage?` and renders either
/// the preview thumbnail (when set) or a placeholder gradient + icon
/// (when not). Copy flips between "Add" and "Change" based on the same
/// state.
private struct PhotoPickerLabel: View {
    let image: UIImage?

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    LinearGradient(
                        colors: [DSColor.accent.opacity(0.25), DSColor.accent.opacity(0.05)],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                    Image(systemName: "photo.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(DSColor.accent)
                }
            }
            .frame(width: 60, height: 60)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(DSColor.border.opacity(0.5), lineWidth: 1)
            )
            VStack(alignment: .leading, spacing: 2) {
                Text(image == nil
                     ? "squads.field.photo.cta.add"
                     : "squads.field.photo.cta.change")
                    .font(.system(size: 14, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
                Text("squads.field.photo.hint")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(DSColor.textSecondary)
                    .lineLimit(2)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(DSColor.textTertiary)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(DSColor.border.opacity(0.4), lineWidth: 1)
        )
    }
}
