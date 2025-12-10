#!/usr/bin/env node

import { writeFileSync } from "fs";
import { resolve } from "path";
import { stringify } from "yaml";
import { loadConfig } from "../config";
import { createDatabase } from "../factories";
import {
  conversations as conversationsTable,
  messages as messagesTable,
} from "../db/schema";
import { and, gte, lte, eq } from "drizzle-orm";

async function main() {
  try {
    const config = loadConfig();
    const db = createDatabase(config.db.path);

    const now = new Date();
    const days = 30;
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    console.log(
      `🔍 Generating eval dataset from conversations between ${start.toISOString()} and ${now.toISOString()}`
    );

    const conversations = db
      .select()
      .from(conversationsTable)
      .where(
        and(
          gte(conversationsTable.createdAt, start),
          lte(conversationsTable.createdAt, now)
        )
      )
      .orderBy(conversationsTable.createdAt)
      .limit(50)
      .all();

    const datasetConversations = [];

    for (const conv of conversations) {
      const messages = db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.conversationUuid, conv.uuid))
        .orderBy(messagesTable.conversationIndex)
        .all();

      const context = buildConversationContext(
        conv.name,
        conv.createdAt,
        messages
      );

      datasetConversations.push({
        conversationUuid: conv.uuid,
        title: conv.name,
        context,
      });
    }

    const dataset = {
      experimentId: "lex-001-baseline",
      promptVersion: "v1",
      conversations: datasetConversations,
    };

    const yamlText = stringify(dataset);
    const outPath = resolve(
      process.cwd(),
      "data/eval/learning-extraction.dataset.yaml"
    );
    writeFileSync(outPath, yamlText, "utf-8");

    console.log(
      `✅ Wrote ${datasetConversations.length} conversations to ${outPath}`
    );
  } catch (error) {
    console.error(
      `❌ Failed to generate eval dataset: ${(error as Error).message}`
    );
    process.exit(1);
  }
}

function buildConversationContext(
  title: string,
  createdAt: Date,
  messages: any[]
): string {
  const body = messages
    .map(
      (m) => `[${String(m.sender).toUpperCase()}]: ${m.text ?? ""}`.trimEnd()
    )
    .join("\n\n");

  return `Conversation: "${title}"\nDate: ${createdAt.toISOString()}\n\n${body}`;
}

main();


