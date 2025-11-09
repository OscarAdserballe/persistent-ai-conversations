import { readFileSync } from 'fs'
import { ConversationImporter, Conversation, Message } from '../core/types'

/**
 * Claude-specific types for parsing export format
 */
interface ClaudeMessage {
  uuid: string
  sender: string
  text: string
  content: Array<{
    type: string
    text?: string
    [key: string]: any
  }>
  created_at: string
  updated_at: string
  files?: Array<{ file_name: string }>
  attachments?: Array<{
    file_name: string
    extracted_content?: string
  }>
}

interface ClaudeConversation {
  uuid: string
  name: string
  summary?: string
  created_at: string
  updated_at: string
  chat_messages: ClaudeMessage[]
}

/**
 * Imports Claude conversations from export format.
 * Handles content flattening from complex structure to searchable text.
 */
export class ClaudeImporter implements ConversationImporter {
  readonly platform = 'claude'

  async *import(filePath: string): AsyncGenerator<Conversation> {
    // Read and parse file
    const content = readFileSync(filePath, 'utf-8')
    const conversations: ClaudeConversation[] = JSON.parse(content)

    // Process each conversation
    for (const conv of conversations) {
      yield this.normalizeConversation(conv)
    }
  }

  private normalizeConversation(conv: ClaudeConversation): Conversation {
    const messages: Message[] = conv.chat_messages.map((msg, index) => ({
      uuid: msg.uuid,
      conversationUuid: conv.uuid,
      conversationIndex: index,
      sender: this.normalizeSender(msg.sender),
      text: this.flattenContent(msg),
      createdAt: new Date(msg.created_at),
      metadata: {
        hasFiles: !!(msg.files && msg.files.length > 0),
        hasAttachments: !!(msg.attachments && msg.attachments.length > 0)
      }
    }))

    return {
      uuid: conv.uuid,
      title: conv.name,
      summary: conv.summary,
      platform: this.platform,
      messages,
      createdAt: new Date(conv.created_at),
      updatedAt: new Date(conv.updated_at),
      metadata: {}
    }
  }

  private normalizeSender(sender: string): 'human' | 'assistant' {
    if (sender === 'human') return 'human'
    if (sender === 'assistant') return 'assistant'

    // Claude might use different sender names
    throw new Error(`Unknown sender type: ${sender}`)
  }

  private flattenContent(message: ClaudeMessage): string {
    const parts: string[] = []

    // Priority 1: Use text field if not empty
    if (message.text && message.text.trim()) {
      parts.push(message.text)
    }

    // Priority 2: Extract text from content array
    if (message.content && message.content.length > 0) {
      for (const item of message.content) {
        if (item.type === 'text' && item.text && item.text.trim()) {
          // Only add if not already in parts (avoid duplication)
          if (!parts.includes(item.text)) {
            parts.push(item.text)
          }
        }

        // Extract text from tool_result content if present
        if (item.type === 'tool_result' && item.content) {
          if (typeof item.content === 'string') {
            parts.push(`[Tool Output]: ${item.content}`)
          }
        }
      }
    }

    // Priority 3: Extract attachment content
    if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        if (attachment.extracted_content && attachment.extracted_content.trim()) {
          parts.push(`[Attachment: ${attachment.file_name}]\n${attachment.extracted_content}`)
        }
      }
    }

    // If still empty, return placeholder
    if (parts.length === 0) {
      return '[No text content]'
    }

    return parts.join('\n\n')
  }
}
