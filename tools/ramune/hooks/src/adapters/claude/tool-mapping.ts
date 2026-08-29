/**
 * Claude Code のツール名（mcp__ramune__*, Edit, Write）を抽象 ActionType にマッピングする。
 */
import type { ActionType } from "../../core/actions.ts";
import { UnknownActionError } from "../../core/policy.ts";

const CLAUDE_TOOL_TO_ACTION: ReadonlyMap<string, ActionType> = new Map<string, ActionType>([
  ["mcp__ramune__ramune_read_graph", "READ_GRAPH"],
  ["mcp__ramune__ramune_claim_ready", "CLAIM_READY"],
  ["mcp__ramune__ramune_claim_integration", "CLAIM_INTEGRATION"],
  ["mcp__ramune__ramune_abandon_assignment", "ABANDON_ASSIGNMENT"],
  ["mcp__ramune__ramune_resume", "RESUME"],
  ["mcp__ramune__ramune_start", "START_SESSION"],
  ["mcp__ramune__ramune_end", "END_SESSION"],
  ["mcp__ramune__ramune_apply_ops", "APPLY_OPS"],
  ["mcp__ramune__ramune_record_result", "RECORD_RESULT"],
  ["mcp__ramune__ramune_submit_candidate", "SUBMIT_CANDIDATE"],
  ["mcp__ramune__ramune_request_replan", "REQUEST_REPLAN"],
  ["mcp__ramune__ramune_advance_integration", "ADVANCE_INTEGRATION"],
  ["mcp__ramune__ramune_record_integration_outcome", "RECORD_INTEGRATION_OUTCOME"],
  ["Edit", "FILE_MUTATION"],
  ["Write", "FILE_MUTATION"],
]);

export function mapClaudeToolToAction(toolName: string): ActionType {
  const action = CLAUDE_TOOL_TO_ACTION.get(toolName);
  if (action === undefined) {
    throw new UnknownActionError(toolName);
  }
  return action;
}
