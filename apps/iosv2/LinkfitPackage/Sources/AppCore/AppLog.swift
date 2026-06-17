import Foundation
import os

/// Thin wrapper over `os.Logger` with a privacy-safe API. Static developer
/// messages use `.public`; anything derived from user data must go through
/// `sensitive(_:)` so it is redacted in device logs / sysdiagnose.
public enum AppLog {
    private static let subsystem = Bundle.main.bundleIdentifier ?? "az.linkfit.v2"

    private static func logger(_ category: String) -> Logger {
        Logger(subsystem: subsystem, category: category)
    }

    public static func debug(_ message: String, category: String = "app") {
        logger(category).debug("\(message, privacy: .public)")
    }

    public static func error(_ message: String, category: String = "app") {
        logger(category).error("\(message, privacy: .public)")
    }

    /// For values that may contain PII (emails, names, ids). Redacted in release.
    public static func sensitive(_ message: String, category: String = "app") {
        logger(category).log("\(message, privacy: .private)")
    }
}
