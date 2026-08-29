/**
 * Antigravity のツール名（mcp_ramune_*, write_to_file, replace_file_content）を抽象 ActionType にマッピングする。
 */
import type { ActionType } from "../../core/actions.ts";
import { UnknownActionError } from "../../core/policy.ts";

const ANTIGRAVITY_TOOL_TO_ACTION: ReadonlyMap<string, ActionType> = new Map<string, ActionType>([
  ["mcp_ramune_ramune_read_graph", "READ_GRAPH"],
  ["mcp_ramune_read_graph", "READ_GRAPH"],
  ["mcp_ramune_ramune_claim_ready", "CLAIM_READY"],
  ["mcp_ramune_claim_ready", "CLAIM_READY"],
  ["mcp_ramune_ramune_claim_integration", "CLAIM_INTEGRATION"],
  ["mcp_ramune_claim_integration", "CLAIM_INTEGRATION"],
  ["mcp_ramune_ramune_abandon_assignment", "ABANDON_ASSIGNMENT"],
  ["mcp_ramune_abandon_assignment", "ABANDON_ASSIGNMENT"],
  ["mcp_ramune_ramune_resume", "RESUME"],
  ["mcp_ramune_resume", "RESUME"],
  ["mcp_ramune_ramune_start", "START_SESSION"],
  ["mcp_ramune_start", "START_SESSION"],
  ["mcp_ramune_ramune_end", "END_SESSION"],
  ["mcp_ramune_end", "END_SESSION"],
  ["mcp_ramune_ramune_apply_ops", "APPLY_OPS"],
  ["mcp_ramune_apply_ops", "APPLY_OPS"],
  ["mcp_ramune_ramune_record_result", "RECORD_RESULT"],
  ["mcp_ramune_record_result", "RECORD_RESULT"],
  ["mcp_ramune_ramune_submit_candidate", "SUBMIT_CANDIDATE"],
  ["mcp_ramune_submit_candidate", "SUBMIT_CANDIDATE"],
  ["mcp_ramune_ramune_request_replan", "REQUEST_REPLAN"],
  ["mcp_ramune_request_replan", "REQUEST_REPLAN"],
  ["mcp_ramune_ramune_advance_integration", "ADVANCE_INTEGRATION"],
  ["mcp_ramune_advance_integration", "ADVANCE_INTEGRATION"],
  ["mcp_ramune_ramune_record_integration_outcome", "RECORD_INTEGRATION_OUTCOME"],
  ["mcp_ramune_record_integration_outcome", "RECORD_INTEGRATION_OUTCOME"],
  ["write_to_file", "FILE_MUTATION"],
  ["replace_file_content", "FILE_MUTATION"],
]);

export function mapAntigravityToolToAction(toolName: string): ActionType {
  const action = ANTIGRAVITY_TOOL_TO_ACTION.get(toolName);
  if (action === undefined) {
    throw new UnknownActionError(toolName);
  }
  return action;
}
