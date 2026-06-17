import Foundation

enum AuthValidation {
    static func isValidEmail(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 5, let at = trimmed.firstIndex(of: "@") else { return false }
        let domain = trimmed[trimmed.index(after: at)...]
        return domain.contains(".") && !domain.hasPrefix(".") && !domain.hasSuffix(".")
    }

    static func isValidPassword(_ value: String) -> Bool {
        value.count >= 6
    }
}

extension String {
    var trimmedValue: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
