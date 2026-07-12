import { z } from "zod";

// fuguBrow runs on Sakana fugu (kept under the legacy `anthropicModel` name to
// avoid a schema/rename sweep). `fugu` = low-latency/flat-cost, `fugu-ultra` = max quality.
export const ALLOWED_ANTHROPIC_MODELS = [
  "fugu",
  "fugu-ultra",
] as const;

export const allowedAnthropicModelSchema = z.enum(ALLOWED_ANTHROPIC_MODELS);

export const createInstanceInput = z.object({
  anthropicModel: allowedAnthropicModelSchema.default("fugu"),
});

export type CreateInstanceInput = z.infer<typeof createInstanceInput>;
