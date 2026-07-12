import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "~/env";

/**
 * Model providers for fuguBrow.
 *
 * Both Sakana and Jina expose OpenAI-compatible surfaces, so a single
 * `@ai-sdk/openai-compatible` provider covers chat + embeddings without the
 * Vercel AI Gateway. Chat runs on Sakana `fugu`; memory embeddings run on
 * Jina `jina-embeddings-v4` (default 1024 dims, matching the pgvector column).
 */

// Chat / agent — Sakana fugu (https://api.sakana.ai/v1)
export const sakana = createOpenAICompatible({
  name: "sakana",
  baseURL: env.SAKANA_BASE_URL,
  apiKey: env.SAKANA_API_KEY,
});

// Memory embeddings — Jina v4 (https://api.jina.ai/v1)
export const jina = createOpenAICompatible({
  name: "jina",
  baseURL: env.JINA_BASE_URL,
  apiKey: env.JINA_API_KEY,
});

/** Chat model instance for the agent loop + compaction (`fugu` / `fugu-ultra`). */
export const chatModel = (id: string) => sakana.chatModel(id);

/** Embedding model instance for memory (`jina-embeddings-v4`, 1024-dim default). */
export const embeddingModel = () => jina.textEmbeddingModel("jina-embeddings-v4");
