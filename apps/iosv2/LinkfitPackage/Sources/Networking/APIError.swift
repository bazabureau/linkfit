import Foundation

/// Typed, exhaustive error surface for every network call. Equatable + Sendable
/// so ViewModels can pattern-match and tests can assert on it precisely.
public enum APIError: Error, Sendable, Equatable {
    /// 401 — session invalid and refresh failed. App should sign the user out.
    case unauthorized
    /// 422 — field-level validation errors keyed by field name.
    case validation([String: String])
    /// Any other non-2xx with the standard error envelope.
    case server(code: String, message: String, requestID: String?)
    /// No connectivity.
    case offline
    /// Request exceeded its deadline.
    case timeout
    /// Other transport-level failure.
    case transport(String)
    /// 2xx body did not match the expected shape.
    case decoding(String)
    case unknown

    /// A human-facing message (already user-safe; localize at the call site if
    /// a more specific copy is needed).
    public var userMessage: String {
        switch self {
        case .unauthorized: return "Your session has expired. Please sign in again."
        case .validation(let fields): return fields.values.first ?? "Please check the form and try again."
        case .server(_, let message, _): return message.isEmpty ? "Something went wrong on our side." : message
        case .offline: return "You appear to be offline."
        case .timeout: return "The request timed out. Please try again."
        case .transport: return "A network error occurred. Please try again."
        case .decoding: return "We received an unexpected response. Please try again."
        case .unknown: return "Something went wrong. Please try again."
        }
    }

    /// Field error for a specific form field, if this is a validation error.
    public func fieldError(_ field: String) -> String? {
        if case .validation(let fields) = self { return fields[field] }
        return nil
    }

    static func map(_ urlError: URLError) -> APIError {
        switch urlError.code {
        case .notConnectedToInternet, .dataNotAllowed, .networkConnectionLost:
            return .offline
        case .timedOut:
            return .timeout
        default:
            return .transport(urlError.localizedDescription)
        }
    }
}
