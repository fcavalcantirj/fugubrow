import { ToolLoopAgent, stepCountIs } from "ai";
import type { ToolSet, SystemModelMessage, StepResult } from "ai";
import { db } from "~/server/clients/db";
import { createComposioClient } from "~/server/clients/composio";
import { chatModel } from "~/server/clients/model";
import { log } from "~/server/clients/logger";
import { buildSystemPrompt } from "./system-prompt";
import {
  createCustomTools,
  searchMemoriesForContext,
} from "./tools";
import { getContextWindow } from "./context/context-window";
import { pruneContext } from "./context/context-pruning";
import {
  loadContextMessages,
  buildContext,
  toPlainRecordSafe,
  toPrismaJson,
  runPostResponseTasks,
  sanitizeString,
  deepSanitize,
} from "./context/build-context";
import {
  DEFAULT_COMPACTION_SETTINGS,
  type CompactionSettings,
} from "./context/token-estimation";
import { stripToolResultEchoes } from "./strip-tool-echoes";
import { clearStreamingMessage } from "~/server/clients/redis";
import type { ReconstructedMessage } from "./types";

type MessageSource = "web" | "telegram" | "cron";

/**
 * Wall-clock budget for a single agent run. The serverless routes cap out at
 * `maxDuration = 300` (Vercel Fluid Compute ceiling on this plan); we stop
 * spawning new tool steps at 260s so `onFinish` (which persists the reply and
 * sends the final message) always runs before Vercel hard-kills the function.
 * Without this, long runs were killed mid-loop and vanished silently.
 */
const AGENT_MAX_RUN_MS = 260_000;

/** Hard ceiling on tool-loop iterations (the time budget usually binds first). */
const AGENT_MAX_STEPS = 100;

type AgentStep = StepResult<ToolSet>;

/** Tracks why a run ended so callers can tailor the final user-facing message. */
export interface AgentRunState {
  timedOut: boolean;
}

/**
 * Builds the UIMessage `parts` array (tool calls + text) from agent steps.
 * Shared by the final `onFinish` write and the incremental progress write so
 * both produce identical content shapes.
 */
export function buildAssistantParts(
  steps: readonly AgentStep[],
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];

  for (const step of steps) {
    for (let i = 0; i < step.toolCalls.length; i++) {
      const tc = step.toolCalls[i]!;
      const tr = step.toolResults[i];
      const tcInput = toPlainRecordSafe(tc.input);
      const tcResult = tr ? toPlainRecordSafe(tr.output) : null;

      parts.push({
        type: "dynamic-tool" as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        state: tcResult ? "output-available" : "input-available",
        input: tcInput,
        output: tcResult ?? {},
      });
    }

    const stepText = stripToolResultEchoes(step.text);
    if (stepText) {
      parts.push({ type: "text" as const, text: stepText });
    }
  }

  return parts;
}

/**
 * Best-effort incremental persistence of accumulated steps to the pre-created
 * assistant row. Called after each step so a hard function kill (Vercel
 * timeout) still leaves the work-so-far in the DB — otherwise the next turn
 * has no memory of what the agent did and the user is stuck re-asking.
 * Never throws; token totals are written authoritatively later by onFinish.
 */
export async function persistAssistantProgress(
  messageId: string,
  steps: readonly AgentStep[],
): Promise<void> {
  try {
    await db.message.update({
      where: { id: messageId },
      data: { content: toPrismaJson(buildAssistantParts(steps)) },
    });
  } catch (error) {
    log.error("agent/progress", "incremental persist failed", {
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Wraps every tool's execute function to sanitize its return value,
 * replacing lone Unicode surrogates with U+FFFD. Composio tool results
 * (e.g. scraped web pages, email bodies) can contain malformed Unicode
 * that produces invalid JSON when the AI SDK serializes the request
 * body for the Anthropic API.
 */
function sanitizeToolResults(tools: ToolSet): ToolSet {
  const wrapped: ToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (tool.execute) {
      const originalExecute = tool.execute;
      wrapped[name] = {
        ...tool,
        execute: async (...args: Parameters<typeof originalExecute>) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- tool execute returns unknown/any; deepSanitize preserves the shape
          const result = await originalExecute(...args);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return deepSanitize(result);
        },
      };
    } else {
      wrapped[name] = tool;
    }
  }
  return wrapped;
}

interface PrepareAgentRunParams {
  instanceId: string;
  userMessage: string;
  source: MessageSource;
  userMessageType?: "hidden";
}

interface PrepareAgentRunResult {
  agent: ToolLoopAgent;
  messages: ReconstructedMessage[];
  assistantMessageId: string;
  runState: AgentRunState;
}

type PrepareResult = { status: "ready"; result: PrepareAgentRunResult };

export async function prepareAgentRun(
  params: PrepareAgentRunParams,
): Promise<PrepareResult> {
  const { instanceId, userMessage, source, userMessageType } = params;

  const instance = await db.composioClawInstance.findUnique({
    where: { id: instanceId },
  });

  if (!instance) {
    throw new Error("Instance not found");
  }

  const user = await db.user.findUnique({
    where: { id: instance.userId },
    select: { timezone: true },
  });

  const userTimezone = user?.timezone ?? "UTC";

  const relevantMemories = await searchMemoriesForContext(instanceId, userMessage);

  const systemPrompt = sanitizeString(
    buildSystemPrompt({
      soulPrompt: instance.soulPrompt,
      identityPrompt: instance.identityPrompt,
      userPrompt: instance.userPrompt,
      relevantMemories,
      hasCompactionSummary: !!instance.lastCompactionSummary,
      userTimezone,
    }),
  );

  const dbMessages = await loadContextMessages(
    instanceId,
    instance.lastCompactionAt,
  );
  const aiMessages = buildContext(
    dbMessages,
    instance.lastCompactionSummary,
    userMessage,
  );

  const contextWindow = getContextWindow(instance.anthropicModel);
  const { messages: prunedMessages } = pruneContext(aiMessages, contextWindow);

  // Add cache breakpoint to last history message (before new user message)
  // so the conversation prefix is cached across turns
  if (prunedMessages.length >= 2) {
    const lastHistoryIndex = prunedMessages.length - 2;
    const msg = prunedMessages[lastHistoryIndex]!;
    prunedMessages[lastHistoryIndex] = {
      ...msg,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    };
  }

  await db.message.create({
    data: {
      instanceId,
      role: "user",
      content: [{ type: "text", text: userMessage }],
      source,
      ...(userMessageType && { messageType: userMessageType }),
    },
  });

  const composio = createComposioClient();
  const session = await composio.create(instance.userId, {
    manageConnections: {
      waitForConnections: true,
    },
  });
  const composioTools = await session.tools();

  const customTools = createCustomTools(instanceId, userTimezone);

  const allTools: ToolSet = sanitizeToolResults({
    ...composioTools,
    ...customTools,
  });

  // Pre-create assistant message row so we can update it in onFinish
  const assistantMessageRow = await db.message.create({
    data: {
      instanceId,
      role: "assistant",
      content: toPrismaJson([]),
      source,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  });

  const model = chatModel(instance.anthropicModel);

  const runState: AgentRunState = { timedOut: false };
  const startedAt = Date.now();

  const agent = new ToolLoopAgent({
    model,
    instructions: {
      role: "system",
      content: systemPrompt,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    } satisfies SystemModelMessage,
    tools: allTools,
    // Stop on either the step ceiling or the wall-clock budget, so onFinish
    // always runs before Vercel's maxDuration hard-kill.
    stopWhen: [
      stepCountIs(AGENT_MAX_STEPS),
      ({ steps }) => {
        const elapsed = Date.now() - startedAt;
        if (elapsed > AGENT_MAX_RUN_MS) {
          runState.timedOut = true;
          log.warn("agent/run", "time budget reached, finalizing", {
            instanceId,
            source,
            steps: steps.length,
            elapsedMs: elapsed,
          });
          return true;
        }
        return false;
      },
    ],
    onFinish: async (result) => {
      try {
        const { totalUsage, steps } = result;
        const inputTokens = totalUsage.inputTokens ?? 0;
        const outputTokens = totalUsage.outputTokens ?? 0;
        const cacheReadTokens =
          totalUsage.inputTokenDetails?.cacheReadTokens ?? 0;
        const cacheWriteTokens =
          totalUsage.inputTokenDetails?.cacheWriteTokens ?? 0;

        const assistantParts = buildAssistantParts(steps);

        log.info("agent/run", "finished", {
          instanceId,
          source,
          steps: steps.length,
          parts: assistantParts.length,
          outputTokens,
          timedOut: runState.timedOut,
          elapsedMs: Date.now() - startedAt,
        });

        // Update the pre-created assistant message with final content + totals
        await db.message.update({
          where: { id: assistantMessageRow.id },
          data: {
            content: toPrismaJson(assistantParts),
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
          },
        });

        // Fire-and-forget post-response tasks
        const totalContextTokens = inputTokens + outputTokens;
        const settings: CompactionSettings = {
          contextWindow,
          ...DEFAULT_COMPACTION_SETTINGS,
        };

        void runPostResponseTasks({
          instanceId,
          instance: {
            anthropicModel: instance.anthropicModel,
            compactionCount: instance.compactionCount,
            memoryFlushCount: instance.memoryFlushCount,
            lastCompactionSummary: instance.lastCompactionSummary,
            lastCompactionAt: instance.lastCompactionAt,
          },
          contextTokens: totalContextTokens,
          settings,
          prunedMessages,
        });
      } catch (error) {
        log.error("agent/onFinish", "post-stream processing failed", {
          instanceId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await clearStreamingMessage(instanceId).catch((error) =>
          log.error("agent/onFinish", "clearStreamingMessage failed", {
            instanceId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },
  });

  return {
    status: "ready",
    result: {
      agent,
      messages: prunedMessages,
      assistantMessageId: assistantMessageRow.id,
      runState,
    },
  };
}

export type {
  PrepareAgentRunParams,
  PrepareResult,
  PrepareAgentRunResult,
  MessageSource,
};
