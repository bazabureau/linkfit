import Foundation

public enum MessageAttachmentType: String, Codable, Sendable, Equatable, Hashable {
    case image, voice
}

/// Conversation list row (`GET /api/v1/conversations`).
public struct ConversationSummary: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let otherUserId: String
    public let otherDisplayName: String
    public let otherPhotoUrl: URL?
    public let lastMessageBody: String?
    public let lastMessageAt: Date?
    public let unread: Bool
}

public struct Message: Codable, Sendable, Equatable, Identifiable, Hashable {
    public let id: String
    public let conversationId: String
    public let senderUserId: String
    public let body: String
    public let attachmentUrl: URL?
    public let attachmentType: MessageAttachmentType?
    public let createdAt: Date

    public init(id: String, conversationId: String, senderUserId: String, body: String,
                attachmentUrl: URL? = nil, attachmentType: MessageAttachmentType? = nil, createdAt: Date) {
        self.id = id
        self.conversationId = conversationId
        self.senderUserId = senderUserId
        self.body = body
        self.attachmentUrl = attachmentUrl
        self.attachmentType = attachmentType
        self.createdAt = createdAt
    }
}

/// Thread fetch (`GET /api/v1/conversations/:id`).
public struct ConversationThread: Codable, Sendable, Equatable {
    public let conversationId: String
    public let otherUserId: String
    public let otherDisplayName: String
    public let otherLastReadAt: Date?
    public let messages: [Message]
}
