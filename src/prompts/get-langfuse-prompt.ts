import { LangfuseClient } from "@langfuse/client";

/**
 * Fetch a prompt from Langfuse by name. Throws if not found or empty.
 */
export async function getLangfusePrompt(
  langfuse: LangfuseClient,
  promptName: string
): Promise<string> {
  if (!promptName) {
    throw new Error("Prompt name is required when fetching from Langfuse.");
  }

  const promptClient = await langfuse.prompt.get(promptName);
  const promptText = (promptClient as { prompt?: string }).prompt;

  if (!promptText) {
    throw new Error(`Prompt "${promptName}" returned no content.`);
  }

  return promptText;
}
