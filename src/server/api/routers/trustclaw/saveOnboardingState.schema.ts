import { z } from "zod";
import { allowedAnthropicModelSchema } from "./createInstance.schema";

export const onboardingStepSchema = z.enum([
  "name",
  "writing-style",
  "personality",
  "emoji",
  "lore",
  "model",
  "integrations",
  "telegram",
]);

export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

export const saveOnboardingStateInput = z.object({
  currentStep: onboardingStepSchema,
  name: z.string().default(""),
  writingStyle: z.string().nullable().default(null),
  personality: z.string().nullable().default(null),
  emoji: z.string().nullable().default(null),
  lore: z.string().default(""),
  anthropicModel: allowedAnthropicModelSchema.default("fugu"),
});

export type SaveOnboardingStateInput = z.infer<typeof saveOnboardingStateInput>;
