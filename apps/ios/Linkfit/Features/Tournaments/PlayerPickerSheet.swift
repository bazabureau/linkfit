import SwiftUI
import Observation

/// Search-and-pick sheet used by RegisterSquadSheet. Backed by the public
/// /players endpoint with a debounced search query.
struct PlayerPickerSheet: View {
    let apiClient: APIClient
    let excludedUserIds: Set<String>
    let remainingSlots: Int
    let onPick: (PlayerSummary) -> Void

    @State private var viewModel: PlayerPickerViewModel
    @Environment(\.dismiss) private var dismiss

    init(apiClient: APIClient,
         excludedUserIds: Set<String>,
         remainingSlots: Int,
         onPick: @escaping (PlayerSummary) -> Void) {
        self.apiClient = apiClient
        self.excludedUserIds = excludedUserIds
        self.remainingSlots = remainingSlots
        self.onPick = onPick
        self._viewModel = State(initialValue: PlayerPickerViewModel(apiClient: apiClient))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DSColor.background.ignoresSafeArea()
                VStack(spacing: DSSpacing.sm) {
                    searchBar
                    if remainingSlots <= 0 {
                        full
                    } else {
                        ScrollView {
                            LazyVStack(spacing: DSSpacing.xs) {
                                content
                            }
                            .padding(.horizontal, DSSpacing.md)
                        }
                    }
                }
                .padding(.top, DSSpacing.sm)
            }
            .navigationTitle("tournaments.picker.title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("common.cancel") { dismiss() }
                        .foregroundStyle(DSColor.textSecondary)
                }
            }
        }
        .task { await viewModel.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            LoadingView(label: String(localized: "tournaments.picker.loading"))
                .frame(height: 240)
        case .empty:
            EmptyStateView(icon: "person.crop.circle.badge.questionmark",
                           title: String(localized: "tournaments.picker.empty.title"),
                           message: String(localized: "tournaments.picker.empty.message"))
                .frame(height: 240)
        case .error(let m):
            ErrorStateView(message: m) { Task { await viewModel.load() } }
                .frame(height: 240)
        case .loaded(let players):
            let filtered = players.filter { !excludedUserIds.contains($0.id) }
            if filtered.isEmpty {
                EmptyStateView(icon: "person.crop.circle.badge.checkmark",
                               title: String(localized: "tournaments.picker.empty.title"),
                               message: String(localized: "tournaments.picker.empty.message"))
                    .frame(height: 240)
            } else {
                ForEach(filtered) { p in
                    Button {
                        onPick(p)
                        dismiss()
                    } label: { row(p) }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var searchBar: some View {
        HStack(spacing: DSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(DSColor.textSecondary)
                .accessibilityHidden(true)
            TextField("", text: Binding(get: { viewModel.query },
                                        set: { viewModel.setQuery($0) }),
                      prompt: Text("tournaments.picker.search.placeholder")
                .foregroundStyle(DSColor.textTertiary))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .foregroundStyle(DSColor.textPrimary)
            if !viewModel.query.isEmpty {
                Button {
                    viewModel.setQuery("")
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(DSColor.textTertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("common.clear"))
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .frame(height: 48)
        .background(Capsule().fill(DSColor.surface))
        .overlay(Capsule().strokeBorder(DSColor.border, lineWidth: 1))
        .padding(.horizontal, DSSpacing.md)
    }

    private func row(_ p: PlayerSummary) -> some View {
        HStack(spacing: DSSpacing.sm) {
            ZStack {
                Circle().fill(DSColor.surfaceElevated)
                Text(initials(p.display_name))
                    .font(.system(.caption, design: .rounded, weight: .heavy))
                    .foregroundStyle(DSColor.textPrimary)
            }
            .frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(p.display_name)
                    .font(.system(.footnote, design: .rounded, weight: .semibold))
                    .foregroundStyle(DSColor.textPrimary)
                if let sport = p.primary_sport, p.primary_elo != nil {
                    // Word-based skill bucket instead of raw "ELO 1450".
                    let levelLabel = SkillLevel.from(elo: p.primary_elo).localizedName
                    Text("\(sport.uppercased()) · \(levelLabel)")
                        .font(.system(.caption2, design: .rounded))
                        .foregroundStyle(DSColor.textSecondary)
                } else if let sport = p.primary_sport {
                    Text(sport.uppercased())
                        .font(.system(.caption2, design: .rounded))
                        .foregroundStyle(DSColor.textSecondary)
                }
            }
            Spacer()
            Image(systemName: "plus.circle.fill")
                .foregroundStyle(DSColor.accent)
        }
        .padding(.horizontal, DSSpacing.sm)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 14).fill(DSColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(DSColor.border, lineWidth: 1))
    }

    private var full: some View {
        VStack(spacing: DSSpacing.sm) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 44))
                .foregroundStyle(DSColor.accent)
            Text("tournaments.picker.full.title")
                .font(DSType.title)
                .foregroundStyle(DSColor.textPrimary)
            Text("tournaments.picker.full.message")
                .font(DSType.body)
                .foregroundStyle(DSColor.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, DSSpacing.lg)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func initials(_ name: String) -> String {
        let comps = name.split(separator: " ")
        let chars = comps.prefix(2).compactMap { $0.first }
        return String(chars).uppercased()
    }
}

@Observable
@MainActor
final class PlayerPickerViewModel {
    private(set) var state: ViewState<[PlayerSummary]> = .idle
    var query: String = ""

    private let apiClient: APIClient
    private var debounceTask: Task<Void, Never>?
    private var loadTask: Task<Void, Never>?

    init(apiClient: APIClient) { self.apiClient = apiClient }

    func setQuery(_ q: String) {
        query = q
        debounceTask?.cancel()
        debounceTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 280_000_000)
            if Task.isCancelled { return }
            await self?.load()
        }
    }

    func load() async {
        loadTask?.cancel()
        let task: Task<Void, Never> = Task { [weak self] in
            await self?.performLoad()
            return
        }
        loadTask = task
        await task.value
    }

    private func performLoad() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if case .loaded = state {} else {
            state = .loading
        }
        do {
            let items = try await apiClient.send(
                .players(q: trimmed.isEmpty ? nil : trimmed, limit: 30)
            ).items
            if Task.isCancelled { return }
            state = items.isEmpty ? .empty : .loaded(items)
        } catch is CancellationError { return }
        catch let error as APIError {
            if Task.isCancelled { return }
            state = .error(message: error.errorDescription ?? String(localized: "players.error.load"))
        } catch {
            if Task.isCancelled { return }
            state = .error(message: error.localizedDescription)
        }
    }
}
