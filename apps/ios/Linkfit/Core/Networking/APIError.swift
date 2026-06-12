import Foundation

/// Typed error envelope returned by the API.
struct APIErrorEnvelope: Decodable, Equatable {
    struct Body: Decodable, Equatable {
        let code: String
        let message: String
        let request_id: String?
    }
    let error: Body
}

enum APIError: Error, LocalizedError, Equatable {
    case offline
    case timeout
    case invalidURL
    case unauthorized
    case forbidden
    case notFound
    case conflict(message: String)
    case validation(message: String)
    case rateLimited
    case server(status: Int, code: String?, message: String)
    case decoding(underlying: String)
    case unknown(message: String)

    var errorDescription: String? {
        switch self {
        case .offline:
            return String(localized: "api.error.offline")
        case .timeout:
            return String(localized: "api.error.timeout")
        case .invalidURL:
            return String(localized: "api.error.invalid_url")
        case .unauthorized:
            return String(localized: "api.error.unauthorized")
        case .forbidden:
            return String(localized: "api.error.forbidden")
        case .notFound:
            return String(localized: "api.error.not_found")
        case .conflict(let message), .validation(let message):
            return message
        case .rateLimited:
            return String(localized: "api.error.rate_limited")
        case .server(_, _, let message):
            return message
        case .decoding:
            return String(localized: "api.error.decoding")
        case .unknown(let message):
            return message
        }
    }

    /// Backend error code carried by the API envelope, if any.
    var code: String? {
        switch self {
        case .unauthorized: return "UNAUTHENTICATED"
        case .forbidden: return "FORBIDDEN"
        case .notFound: return "NOT_FOUND"
        case .conflict: return "CONFLICT"
        case .validation: return "VALIDATION"
        case .rateLimited: return "RATE_LIMITED"
        case .server(_, let code, _): return code
        case .offline, .timeout, .invalidURL, .decoding, .unknown: return nil
        }
    }

    /// User-facing localized message. Maps backend codes to localized strings
    /// so users see friendly text in their locale instead of raw English
    /// backend messages. Falls back to the raw `errorDescription` when no
    /// mapping applies.
    var localizedMessage: String {
        // Special-case transport errors that don't carry a backend code.
        switch self {
        case .offline:
            return String(localized: "error.network_offline")
        case .timeout, .invalidURL, .decoding:
            return errorDescription ?? String(localized: "error.generic")
        default:
            break
        }
        guard let code else { return errorDescription ?? String(localized: "error.generic") }
        switch code {
        case "UNAUTHENTICATED": return String(localized: "error.unauthenticated")
        case "VALIDATION", "VALIDATION_ERROR": return String(localized: "error.validation")
        case "NOT_FOUND": return String(localized: "error.not_found")
        case "CONFLICT": return String(localized: "error.conflict")
        case "PRECONDITION_FAILED": return String(localized: "error.precondition")
        case "RATE_LIMITED": return String(localized: "error.rate_limited")
        case "INTERNAL": return String(localized: "error.internal")
        case "FORBIDDEN": return String(localized: "error.forbidden")
        default: return errorDescription ?? String(localized: "error.generic")
        }
    }

    static func from(envelope: APIErrorEnvelope, status: Int) -> APIError {
        let code = envelope.error.code
        let message = envelope.error.message
        switch code {
        case "UNAUTHENTICATED": return .unauthorized
        case "FORBIDDEN":       return .forbidden
        case "NOT_FOUND":       return .notFound
        case "CONFLICT":        return .conflict(message: message)
        case "VALIDATION_ERROR":return .validation(message: message)
        case "RATE_LIMITED":    return .rateLimited
        default:                return .server(status: status, code: code, message: message)
        }
    }
}
