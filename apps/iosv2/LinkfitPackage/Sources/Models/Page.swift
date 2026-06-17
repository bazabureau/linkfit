import Foundation

/// Cursor-paginated list envelope: `{ items: [T], next_cursor: String? }`.
/// Pass `nextCursor` back as the `cursor` query param to load the following page;
/// `nil` means the end of the list.
public struct Page<T: Decodable & Sendable>: Decodable, Sendable {
    public let items: [T]
    public let nextCursor: String?

    public init(items: [T], nextCursor: String?) {
        self.items = items
        self.nextCursor = nextCursor
    }

    public var hasMore: Bool { nextCursor != nil }
}

extension Page: Equatable where T: Equatable {}
