import Foundation

/// Type-safe wrapper for the only property values the analytics layer is
/// willing to serialize. Forces callers through a closed enum so we cannot
/// accidentally serialize arbitrary `Any` blobs — that's how PII (e.g. raw
/// `User` structs, tokens, payment objects) historically leaks into analytics
/// pipelines.
///
/// Adding a new case here is a deliberate widening — review what it permits
/// before extending. In particular, do NOT add a `.dictionary` or `.any` case;
/// nested structures should be flattened into multiple primitive properties at
/// the call site so the schema stays auditable in the backend.
enum AnalyticsValue: Codable, Sendable, Equatable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)

    // MARK: - Codable
    //
    // We use a single-value container and dispatch on the wrapped type. The
    // discriminator order matters: `bool` MUST come before `int` on decode,
    // because JSONDecoder happily decodes `true` as `1`. On encode there's no
    // ambiguity — we know which case we are.

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .int(let value):    try container.encode(value)
        case .double(let value): try container.encode(value)
        case .bool(let value):   try container.encode(value)
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let bool = try? container.decode(Bool.self) {
            self = .bool(bool)
            return
        }
        if let int = try? container.decode(Int.self) {
            self = .int(int)
            return
        }
        if let double = try? container.decode(Double.self) {
            self = .double(double)
            return
        }
        if let string = try? container.decode(String.self) {
            self = .string(string)
            return
        }
        throw DecodingError.dataCorruptedError(
            in: container,
            debugDescription: "AnalyticsValue: unsupported scalar type"
        )
    }
}
