import Foundation
import Security
import CryptoKit
import AppCore

/// Public-key (SPKI) certificate pinning. Computes the SHA-256 of the server
/// leaf's Subject Public Key Info and compares it to the configured base64 pins.
/// Disabled entirely when no pins are configured (the session uses no delegate),
/// so dev builds work out of the box; supply pins via `CERT_PINS` to enable.
///
/// Pin rotation: ship the *next* certificate's pin alongside the current one
/// before rotating, so an app already in the field keeps trusting the server
/// across the changeover.
final class PinningDelegate: NSObject, URLSessionDelegate {
    private let pins: Set<String>

    init(pins: [String]) { self.pins = Set(pins) }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge
    ) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        guard
            challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
            let trust = challenge.protectionSpace.serverTrust
        else {
            return (.performDefaultHandling, nil)
        }

        // 1) The chain must be valid against the system trust store.
        var error: CFError?
        guard SecTrustEvaluateWithError(trust, &error) else {
            AppLog.error("TLS chain evaluation failed", category: "net")
            return (.cancelAuthenticationChallenge, nil)
        }

        // 2) The leaf's public key must match a configured pin.
        guard
            let key = SecTrustCopyKey(trust),
            let hash = Self.spkiSHA256Base64(key),
            pins.contains(hash)
        else {
            AppLog.error("TLS pin mismatch — rejecting connection", category: "net")
            return (.cancelAuthenticationChallenge, nil)
        }

        return (.useCredential, URLCredential(trust: trust))
    }

    static func spkiSHA256Base64(_ key: SecKey) -> String? {
        guard
            let keyData = SecKeyCopyExternalRepresentation(key, nil) as Data?,
            let attributes = SecKeyCopyAttributes(key) as? [CFString: Any],
            let header = asn1Header(for: attributes)
        else { return nil }

        var spki = Data(header)
        spki.append(keyData)
        return Data(SHA256.hash(data: spki)).base64EncodedString()
    }

    /// ASN.1 SubjectPublicKeyInfo prefix for the common key types, keyed by
    /// (type, size). Prepended to the raw key to reconstruct the DER SPKI.
    private static func asn1Header(for attributes: [CFString: Any]) -> [UInt8]? {
        guard
            let type = attributes[kSecAttrKeyType] as? String,
            let bits = attributes[kSecAttrKeySizeInBits] as? Int
        else { return nil }

        let rsa = kSecAttrKeyTypeRSA as String
        let ec = kSecAttrKeyTypeECSECPrimeRandom as String

        switch (type, bits) {
        case (rsa, 2048):
            return [0x30, 0x82, 0x01, 0x22, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
                    0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x01, 0x0f, 0x00]
        case (rsa, 4096):
            return [0x30, 0x82, 0x02, 0x22, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
                    0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00, 0x03, 0x82, 0x02, 0x0f, 0x00]
        case (ec, 256):
            return [0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
                    0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03,
                    0x42, 0x00]
        case (ec, 384):
            return [0x30, 0x76, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02,
                    0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22, 0x03, 0x62, 0x00]
        default:
            return nil
        }
    }
}
