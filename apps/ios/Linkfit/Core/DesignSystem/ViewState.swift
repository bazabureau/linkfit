import Foundation

/// Every list / detail / form screen MUST model its state with this enum.
/// Reviewers should reject any feature that uses raw optionals + booleans
/// instead — that's how silent spinners and missing empty/error states sneak in.
enum ViewState<T: Equatable>: Equatable {
    case idle
    case loading
    case loaded(T)
    case empty
    case error(message: String)
}
