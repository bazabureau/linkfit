import Foundation

/// The backend's uniform error body: `{ "error": { code, message, request_id } }`.
/// Validation failures (HTTP 422) additionally carry per-field messages under
/// `error.fields` (or `error.errors`), which we decode best-effort.
public struct APIErrorEnvelope: Decodable, Sendable, Equatable {
    public struct Body: Decodable, Sendable, Equatable {
        public let code: String
        public let message: String
        public let requestId: String?
        public let fields: [String: String]?

        private enum CodingKeys: String, CodingKey {
            case code, message, requestId, fields, errors
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            self.code = (try? c.decode(String.self, forKey: .code)) ?? "unknown"
            self.message = (try? c.decode(String.self, forKey: .message)) ?? ""
            self.requestId = try? c.decodeIfPresent(String.self, forKey: .requestId)
            // Accept either `fields` or `errors` as the per-field map.
            if let f = try? c.decodeIfPresent([String: String].self, forKey: .fields) {
                self.fields = f
            } else {
                self.fields = try? c.decodeIfPresent([String: String].self, forKey: .errors)
            }
        }

        public init(code: String, message: String, requestId: String? = nil, fields: [String: String]? = nil) {
            self.code = code
            self.message = message
            self.requestId = requestId
            self.fields = fields
        }
    }

    public let error: Body
}
