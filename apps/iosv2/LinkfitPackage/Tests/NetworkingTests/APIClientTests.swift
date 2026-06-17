import Testing
import Foundation
import Models
@testable import Networking

@Suite(.serialized)
struct APIClientTests {
    private func makeClient(tokenStore: any TokenStoring = MockTokenStore()) -> URLSessionAPIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return URLSessionAPIClient(
            baseURL: URL(string: "https://api.test")!,
            tokenStore: tokenStore,
            configuration: config
        )
    }

    private let userJSON = #"{"id":"u1","email":"a@b.c","display_name":"Kamran Namazov","created_at":"2026-06-01T10:00:00Z"}"#

    @Test func decodesSuccessBodyWithSnakeCaseAndDates() async throws {
        let json = userJSON
        StubURLProtocol.handler = { _ in (200, json.data(using: .utf8)!) }
        let client = makeClient()

        let user: User = try await client.send(Endpoint(method: .get, path: "/api/v1/me", requiresAuth: false))

        #expect(user.id == "u1")
        #expect(user.displayName == "Kamran Namazov")
        #expect(user.createdAt != nil)
    }

    @Test func mapsValidationErrors() async {
        StubURLProtocol.handler = { _ in
            let body = #"{"error":{"code":"validation","message":"Invalid","fields":{"email":"Email is required"}}}"#
            return (422, body.data(using: .utf8)!)
        }
        let client = makeClient()

        await #expect(throws: APIError.validation(["email": "Email is required"])) {
            try await client.send(Endpoint(method: .post, path: "/api/v1/auth/register", requiresAuth: false))
        }
    }

    @Test func mapsServerErrorWithRequestID() async {
        StubURLProtocol.handler = { _ in
            let body = #"{"error":{"code":"server_error","message":"Boom","request_id":"req-9"}}"#
            return (500, body.data(using: .utf8)!)
        }
        let client = makeClient()

        do {
            try await client.send(Endpoint(method: .get, path: "/api/v1/x", requiresAuth: false))
            Issue.record("expected an error")
        } catch let APIError.server(code, message, requestID) {
            #expect(code == "server_error")
            #expect(message == "Boom")
            #expect(requestID == "req-9")
        } catch {
            Issue.record("wrong error: \(error)")
        }
    }

    @Test func refreshesOn401ThenRetriesOriginalRequest() async throws {
        let store = MockTokenStore(
            AuthTokens(accessToken: "old", refreshToken: "r", expiresAt: Date().addingTimeInterval(900))
        )
        let protectedCalls = Counter()
        let userJSON = userJSON
        StubURLProtocol.handler = { request in
            if request.url!.path.contains("/auth/refresh") {
                let body = #"{"user":{"id":"u1","email":"a@b.c","display_name":"K","created_at":"2026-06-01T10:00:00Z"},"access_token":"new","refresh_token":"r2","access_token_expires_in_seconds":900}"#
                return (200, body.data(using: .utf8)!)
            }
            // First protected hit 401s, the retry (after refresh) succeeds.
            if protectedCalls.next() == 0 {
                return (401, #"{"error":{"code":"unauthorized","message":"expired"}}"#.data(using: .utf8)!)
            }
            return (200, userJSON.data(using: .utf8)!)
        }
        let client = makeClient(tokenStore: store)

        let user: User = try await client.send(Endpoint(method: .get, path: "/api/v1/me"))

        #expect(user.id == "u1")
        #expect(await store.currentAccessToken() == "new")  // tokens rotated
    }
}
