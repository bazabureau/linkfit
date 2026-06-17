import Foundation
import Security

/// `SecureStore` backed by the iOS Keychain (generic password items). Items are
/// `AfterFirstUnlockThisDeviceOnly`: readable after the first unlock following a
/// reboot, never synced to iCloud or migrated to another device.
public struct KeychainStore: SecureStore {
    private let service: String
    /// `kSec...` accessibility constant bridged to `String` so the struct stays
    /// `Sendable`; bridged back to `CFString` when building the query.
    private let accessibility: String

    public init(
        service: String,
        accessibility: String = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String
    ) {
        self.service = service
        self.accessibility = accessibility
    }

    public func data(for key: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    public func set(_ data: Data, for key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: accessibility,
        ]

        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = accessibility
            SecItemAdd(insert as CFDictionary, nil)
        }
    }

    public func remove(_ key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
