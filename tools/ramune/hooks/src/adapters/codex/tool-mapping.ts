/**
 * Codex CLI のツール名（ramune_*, apply_diff, write_file）を抽象 ActionType にマッピングする。
 */
import type { ActionType } from "../../core/actions.ts";
import { UnknownActionError } from "../../core/policy.ts";

const CODEX_TOOL_TO_ACTION: ReadonlyMap<string, ActionType> = new Map<string, ActionType>([
  ["ramune_read_graph", "READ_GRAPH"],
  ["mcp__ramune__ramune_read_graph", "READ_GRAPH"],
  ["mcp_ramune_ramune_read_graph", "READ_GRAPH"],
  ["ramune_claim_ready", "CLAIM_READY"],
  ["mcp__ramune__ramune_claim_ready", "CLAIM_READY"],
  ["mcp_ramune_ramune_claim_ready", "CLAIM_READY"],
  ["ramune_claim_integration", "CLAIM_INTEGRATION"],
  ["mcp__ramune__ramune_claim_integration", "CLAIM_INTEGRATION"],
  ["mcp_ramune_ramune_claim_integration", "CLAIM_INTEGRATION"],
  ["ramune_abandon_assignment", "ABANDON_ASSIGNMENT"],
  ["mcp__ramune__ramune_abandon_assignment", "ABANDON_ASSIGNMENT"],
  ["mcp_ramune_ramune_abandon_assignment", "ABANDON_ASSIGNMENT"],
  ["ramune_resume", "RESUME"],
  ["mcp__ramune__ramune_resume", "RESUME"],
  ["mcp_ramune_ramune_resume", "RESUME"],
  ["ramune_start", "START_SESSION"],
  ["mcp__ramune__ramune_start", "START_SESSION"],
  ["mcp_ramune_ramune_start", "START_SESSION"],
  ["ramune_end", "END_SESSION"],
  ["mcp__ramune__ramune_end", "END_SESSION"],
  ["mcp_ramune_ramune_end", "END_SESSION"],
  ["ramune_apply_ops", "APPLY_OPS"],
  ["mcp__ramune__ramune_apply_ops", "APPLY_OPS"],
  ["mcp_ramune_ramune_apply_ops", "APPLY_OPS"],
  ["ramune_record_result", "RECORD_RESULT"],
  ["mcp__ramune__ramune_record_result", "RECORD_RESULT"],
  ["mcp_ramune_ramune_record_result", "RECORD_RESULT"],
  ["ramune_submit_candidate", "SUBMIT_CANDIDATE"],
  ["mcp__ramune__ramune_submit_candidate", "SUBMIT_CANDIDATE"],
  ["mcp_ramune_ramune_submit_candidate", "SUBMIT_CANDIDATE"],
  ["ramune_request_replan", "REQUEST_REPLAN"],
  ["mcp__ramune__ramune_request_replan", "REQUEST_REPLAN"],
  ["mcp_ramune_ramune_request_replan", "REQUEST_REPLAN"],
  ["ramune_advance_integration", "ADVANCE_INTEGRATION"],
  ["mcp__ramune__ramune_advance_integration", "ADVANCE_INTEGRATION"],
  ["mcp_ramune_ramune_advance_integration", "ADVANCE_INTEGRATION"],
  ["ramune_record_integration_outcome", "RECORD_INTEGRATION_OUTCOME"],
  ["mcp__ramune__ramune_record_integration_outcome", "RECORD_INTEGRATION_OUTCOME"],
  ["mcp_ramune_ramune_record_integration_outcome", "RECORD_INTEGRATION_OUTCOME"],
  ["apply_diff", "FILE_MUTATION"],
  ["write_file", "FILE_MUTATION"],
]);

export function mapCodexToolToAction(toolName: string): ActionType {
  const action = CODEX_TOOL_TO_ACTION.get(toolName);
  if (action === undefined) {
    throw new UnknownActionError(toolName);
  }
  return action;
}
