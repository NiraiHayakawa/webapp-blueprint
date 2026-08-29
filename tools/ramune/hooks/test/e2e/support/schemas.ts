import { z } from "zod";

const ClaudeDenyOutputSchema = z.looseObject({
  hookSpecificOutput: z.looseObject({
    hookEventName: z.literal("PreToolUse"),
    permissionDecision: z.literal("deny"),
    permissionDecisionReason: z.string().min(1),
  }),
});

const AntigravityDenySchema = z.looseObject({
  decision: z.literal("deny"),
  reason: z.string().min(1),
});

const AntigravityAllowSchema = z.looseObject({
  decision: z.literal("allow"),
});

const AntigravityOutputSchema = z.union([
  AntigravityAllowSchema,
  AntigravityDenySchema,
  z.looseObject({}),
]);

const CodexDenySchema = z.looseObject({
  hookSpecificOutput: z.looseObject({
    hookEventName: z.literal("PreToolUse"),
    permissionDecision: z.literal("deny"),
    permissionDecisionReason: z.string().min(1),
  }),
});

export type ParsedResponse =
  | { readonly decision: "allow" }
  | { readonly decision: "deny"; readonly reason: string };

export function parseClaudeResponse(stdout: string): ParsedResponse {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return { decision: "allow" };
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    const validated = ClaudeDenyOutputSchema.parse(parsed);
    return {
      decision: "deny",
      reason: validated.hookSpecificOutput.permissionDecisionReason,
    };
  } catch (error) {
    throw new Error(`Claude output did not match allow or deny schema: ${stdout}`, {
      cause: error,
    });
  }
}

function resolveDecisionFromPayload(validated: {
  readonly decision?: string;
  readonly reason?: string;
}): ParsedResponse {
  if (validated.decision === "deny" && validated.reason !== undefined) {
    return { decision: "deny", reason: validated.reason };
  }
  return { decision: "allow" };
}

export function parseAntigravityResponse(stdout: string): ParsedResponse {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return { decision: "allow" };
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    const validated = AntigravityOutputSchema.parse(parsed);
    return resolveDecisionFromPayload(validated);
  } catch (error) {
    throw new Error(`Antigravity output did not match expected schema: ${stdout}`, {
      cause: error,
    });
  }
}

function resolveCodexDecision(stdout: string): ParsedResponse {
  const parsed: unknown = JSON.parse(stdout);
  const deny = CodexDenySchema.safeParse(parsed);
  if (deny.success) {
    return {
      decision: "deny",
      reason: deny.data.hookSpecificOutput.permissionDecisionReason,
    };
  }
  z.looseObject({}).parse(parsed);
  return { decision: "allow" };
}

export function parseCodexResponse(stdout: string): ParsedResponse {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return { decision: "allow" };
  }

  try {
    return resolveCodexDecision(trimmed);
  } catch (error) {
    throw new Error(`Codex output did not match expected schema: ${stdout}`, { cause: error });
  }
}
