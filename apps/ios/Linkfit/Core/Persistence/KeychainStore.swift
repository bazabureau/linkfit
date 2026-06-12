import Foundation
import Security

protocol TokenStoring: Sendable {
    func save(access: String, refresh: String) throws
    func accessToken() -> String?
    func refreshToken() -> String?
    func clear() throws
}

/// Keychain-backed token store. Keys are namespaced by `service`. We never log,
/// never print, never send these to analytics — they leave only inside an
/// Authorization header.
final class KeychainTokenStore: TokenStoring, @unchecked Sendable {
    private let service: String
    private let accessKey = "access_token"
    private let refreshKey = "refresh_token"

    init(service: String) {
        self.service = service
    }

    func save(access: String, refresh: String) throws {
        try set(accessKey, value: access)
        try set(refreshKey, value: refresh)
    }

    func accessToken() -> String? { read(accessKey) }
    func refreshToken() -> String? { read(refreshKey) }

    func clear() throws {
        try delete(accessKey)
        try delete(refreshKey)
    }

    // MARK: - Internal

    private func set(_ key: String, value: String) throws {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary) // ignore "not found"
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.unhandled(status: status)
        }
    }

    private func read(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func delete(_ key: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unhandled(status: status)
        }
    }
}

enum KeychainError: Error {
    case unhandled(status: OSStatus)
}
