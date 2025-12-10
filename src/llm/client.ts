import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { LanguageModel } from "ai";

// Initialize OpenRouter provider
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

/**
 * Get a Vercel AI SDK compatible model instance from OpenRouter.
 * @param modelId - The OpenRouter model ID (e.g. 'google/gemini-flash-1.5')
 * @returns LanguageModel instance
 */
export function getModel(modelId: string): LanguageModel {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set in environment variables");
  }
  return openrouter(modelId);
}


