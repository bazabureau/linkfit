import Foundation

/// Exponential-backoff retry helper for transient network failures.
///
/// Wraps an `async throws` closure and retries it on transport-level
/// errors that are reasonably expected to clear on their own — flaky
/// cellular, captive-portal redirects mid-roam, AWS ALB 503 during a
/// rolling deploy. Anything the caller's request "did wrong" (400/401/
/// 403/404/409/422) is NOT retried; resending it would only burn the
/// user's data plan and double-emit side effects on the server.
///
/// Why this lives in `Core/Networking` instead of inside `APIClient`:
/// the client's mutation methods auto-retry once internally (see
/// `URLSessionAPIClient.send`), but ViewModels that drive screen-level
/// loads — feed, profile, leaderboard — want a longer ladder when the
/// device is on a marginal link. Surfacing `RequestRetry.run { ... }` as
/// an opt-in lets a VM say "this fetch is important, give it three
/// shots" without forcing every other call site to wear that cost.
///
/// Usage from a ViewModel:
/// ```
/// do {
///     let result = try await RequestRetry.run {
///         try await self.api.send(Endpoint<MyResponse>.thing())
///     }
///     self.state = .loaded(result)
/// } catch {
///     await ToastCenter.shared.errorWithRetry(
///         message: (error as? APIError)?.localizedMessage
///                  ?? String(localized: "error.generic")
///     ) { [weak self] in await self?.load() }
/// }
/// ```
enum RequestRetry {

    /// Run `closure`, retrying it on transient errors. `closure` is invoked
    /// up to `maxAttempts` times total (so a `maxAttempts: 3` means the
    /// original call + 2 retries). The `backoff` array supplies the delay
    /// _before_ each retry — index 0 is the wait before retry #1, index 1
    /// before retry #2, etc. If the array is shorter than `maxAttempts-1`,
    /// the last value repeats.
    ///
    /// Non-transient errors (4xx, decoding, validation, etc.) bypass the
    /// retry ladder and propagate immediately — there's no point waiting
    /// half a second to re-send a request the server already rejected as
    /// malformed.
    @discardableResult
    static func run<T: Sendable>(
        _ closure: @Sendable () async throws -> T,
        maxAttempts: Int = 3,
        backoff: [TimeInterval] = [0.5, 1.0, 2.0]
    ) async throws -> T {
        // Guard against pathological callers — a zero or negative budget
        // collapses to a single attempt rather than throwing immediately,
        // which would be a more surprising contract change.
        let attempts = max(maxAttempts, 1)
        var lastError: Error = APIError.unknown(message: "RequestRetry: no attempts ran")

        for attempt in 0..<attempts {
            // Honor cooperative cancellation between attempts — a screen
            // tear-down should not keep retrying in the background.
            if Task.isCancelled { throw CancellationError() }

            do {
                return try await closure()
            } catch is CancellationError {
                // User navigated away mid-flight. Don't retry; the caller
                // doesn't care about the result anymore.
                throw CancellationError()
            } catch {
                lastError = error

                // Non-transient → fail fast. Caller surfaces an error toast.
                guard Self.isTransient(error) else { throw error }

                // No retries left? Surface the most recent error.
                let isLastAttempt = (attempt == attempts - 1)
                if isLastAttempt { throw error }

                // Pick the backoff slot for the next retry. If the array
                // is shorter than the ladder, clamp to the last entry so
                // we don't crash on out-of-bounds — and don't sleep more
                // than 30s in any single hop, in case a caller passes
                // something absurd.
                let slotIndex = min(attempt, backoff.count - 1)
                let waitSeconds: TimeInterval = backoff.isEmpty
                    ? 0
                    : min(max(backoff[slotIndex], 0), 30)
                if waitSeconds > 0 {
                    try? await Task.sleep(nanoseconds: UInt64(waitSeconds * 1_000_000_000))
                }
            }
        }

        // Unreachable — the loop either returns on success or throws on
        // exhaustion. Keep the throw here so the compiler sees a
        // terminating statement on every path.
        throw lastError
    }

    /// Decide whether `error` is worth retrying. Conservative by design:
    /// only network-level hiccups (offline / timeout / DNS) and the three
    /// "load balancer is between deploys" 5xx codes — 502, 503, 504 —
    /// qualify. Everything else (other 5xx, 4xx, decoding) is treated as
    /// a hard failure so we don't paper over real bugs with delay.
    static func isTransient(_ error: Error) -> Bool {
        if let api = error as? APIError {
            switch api {
            case .offline, .timeout:
                return true
            case .server(let status, _, _):
                return status == 502 || status == 503 || status == 504
            default:
                return false
            }
        }
        // Foundation transport errors that surface before they reach the
        // APIClient's mapping layer — typically from VM-direct URLSession
        // calls. Same three-code policy.
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain {
            switch ns.code {
            case NSURLErrorTimedOut,
                 NSURLErrorNotConnectedToInternet,
                 NSURLErrorNetworkConnectionLost,
                 NSURLErrorCannotConnectToHost,
                 NSURLErrorDNSLookupFailed,
                 NSURLErrorCannotFindHost,
                 NSURLErrorDataNotAllowed:
                return true
            default:
                return false
            }
        }
        return false
    }
}
