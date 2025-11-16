import { describe, it, expect, beforeEach } from "vitest";
import { ClaudeImporter } from "../../../src/importers/claude";
import { resolve } from "path";

describe("ClaudeImporter", () => {
  let importer: ClaudeImporter;

  beforeEach(() => {
    importer = new ClaudeImporter();
  });

  describe("platform", () => {
    it('should be "claude"', () => {
      expect(importer.platform).toBe("claude");
    });
  });

  describe("import", () => {
    it("should import minimal fixture", async () => {
      const fixturePath = resolve(
        __dirname,
        "../../fixtures/conversations/minimal.json"
      );
      const conversations = [];

      for await (const conv of importer.import(fixturePath)) {
        conversations.push(conv);
      }

      expect(conversations).toHaveLength(2);
    });

    it("should normalize conversation metadata", async () => {
      const fixturePath = resolve(
        __dirname,
        "../../fixtures/conversations/minimal.json"
      );
      const conversations = [];

      for await (const conv of importer.import(fixturePath)) {
        conversations.push(conv);
      }

      const first = conversations[0];
      expect(first.uuid).toBe("conv-1");
      expect(first.title).toBe("Test Conversation 1");
      expect(first.summary).toBe(
        "A simple test conversation about programming"
      );
      expect(first.platform).toBe("claude");
      expect(first.createdAt).toBeInstanceOf(Date);
      expect(first.updatedAt).toBeInstanceOf(Date);
      expect(first.messages).toHaveLength(5);
    });

    it("should normalize message structure", async () => {
      const fixturePath = resolve(
        __dirname,
        "../../fixtures/conversations/minimal.json"
      );
      const conversations = [];

      for await (const conv of importer.import(fixturePath)) {
        conversations.push(conv);
      }

      const firstMessage = conversations[0].messages[0];
      expect(firstMessage.uuid).toBe("msg-1-1");
      expect(firstMessage.conversationUuid).toBe("conv-1");
      expect(firstMessage.conversationIndex).toBe(0);
      expect(firstMessage.sender).toBe("human");
      expect(firstMessage.text).toBe("What is TypeScript?");
      expect(firstMessage.createdAt).toBeInstanceOf(Date);
    });

    it("should assign sequential conversation indexes", async () => {
      const fixturePath = resolve(
        __dirname,
        "../../fixtures/conversations/minimal.json"
      );
      const conversations = [];

      for await (const conv of importer.import(fixturePath)) {
        conversations.push(conv);
      }

      const messages = conversations[0].messages;
      expect(messages[0].conversationIndex).toBe(0);
      expect(messages[1].conversationIndex).toBe(1);
      expect(messages[2].conversationIndex).toBe(2);
      expect(messages[3].conversationIndex).toBe(3);
      expect(messages[4].conversationIndex).toBe(4);
    });

    it("should normalize sender field", async () => {
      const fixturePath = resolve(
        __dirname,
        "../../fixtures/conversations/minimal.json"
      );
      const conversations = [];

      for await (const conv of importer.import(fixturePath)) {
        conversations.push(conv);
      }

      const messages = conversations[0].messages;
      expect(messages[0].sender).toBe("human");
      expect(messages[1].sender).toBe("assistant");
      expect(messages[2].sender).toBe("human");
      expect(messages[3].sender).toBe("assistant");
    });
  });

  describe("edge cases", () => {
    it("should handle empty text field with content array", async () => {
      const fixturePath = resolve(
        __dirname,
        "../../fixtures/conversations/edge-cases.json"
      );
      const conversations = [];

      for await (const conv of importer.import(fixturePath)) {
        conversations.push(conv);
      }

      const firstMessage = conversations[0].messages[0];
      expect(firstMessage.text).toContain("Message with empty text field");
    });

    it("should extract tool_result content", async () => {
      const fixturePath = resolve(
        __dirname,
        "../../fixtures/conversations/edge-cases.json"
      );
      const conversations = [];

      for await (const conv of importer.import(fixturePath)) {
        conversations.push(conv);
      }

      const secondMessage = conversations[0].messages[1];
      expect(secondMessage.text).toContain("Tool Output");
    });

    it("should extract attachment extracted_content", async () => {
      const fixturePath = resolve(
        __dirname,
        "../../fixtures/conversations/edge-cases.json"
      );
      const conversations = [];

      for await (const conv of importer.import(fixturePath)) {
        conversations.push(conv);
      }

      const thirdMessage = conversations[0].messages[2];
      expect(thirdMessage.text).toContain(
        "This is the content of the attached file"
      );
      expect(thirdMessage.text).toContain("Attachment: test.txt");
    });

    it("should not duplicate text from content array", async () => {
      const fixturePath = resolve(
        __dirname,
        "../../fixtures/conversations/minimal.json"
      );
      const conversations = [];

      for await (const conv of importer.import(fixturePath)) {
        conversations.push(conv);
      }

      const firstMessage = conversations[0].messages[0];
      const occurrences = (
        firstMessage.text.match(/What is TypeScript\?/g) || []
      ).length;
      expect(occurrences).toBe(1); // Should only appear once
    });

    it("should handle messages with no text content", async () => {
      // Create a test case with truly empty message
      const fixturePath = resolve(
        __dirname,
        "../../fixtures/conversations/edge-cases.json"
      );
      const conversations = [];

      for await (const conv of importer.import(fixturePath)) {
        conversations.push(conv);
      }

      // All messages should have some text (even if placeholder)
      conversations.forEach((conv) => {
        conv.messages.forEach((msg) => {
          expect(msg.text).toBeTruthy();
          expect(msg.text.length).toBeGreaterThan(0);
        });
      });
    });
  });

  describe("metadata", () => {
    it("should track file attachments in metadata", async () => {
      const fixturePath = resolve(
        __dirname,
        "../../fixtures/conversations/edge-cases.json"
      );
      const conversations = [];

      for await (const conv of importer.import(fixturePath)) {
        conversations.push(conv);
      }

      const messageWithFile = conversations[0].messages[2];
      expect(messageWithFile.metadata.hasFiles).toBe(true);
      expect(messageWithFile.metadata.hasAttachments).toBe(true);
    });

    it("should set false for messages without files", async () => {
      const fixturePath = resolve(
        __dirname,
        "../../fixtures/conversations/minimal.json"
      );
      const conversations = [];

      for await (const conv of importer.import(fixturePath)) {
        conversations.push(conv);
      }

      const normalMessage = conversations[0].messages[0];
      expect(normalMessage.metadata.hasFiles).toBe(false);
      expect(normalMessage.metadata.hasAttachments).toBe(false);
    });
  });
});
