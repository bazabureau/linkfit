import Foundation

/// Minimal secure key/value contract. `KeychainStore` is the production backing;
/// tests inject an in-memory implementation so they never touch the real Keychain
/// (which is unavailable / flaky in the test host).
public protocol SecureStore: Sendable {
    func data(for key: String) -> Data?
    func set(_ data: Data, for key: String)
    func remove(_ key: String)
}
