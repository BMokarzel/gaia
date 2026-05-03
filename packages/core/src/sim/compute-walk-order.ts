// =============================================================================
// compute-walk-order — walk a CodeNode tree and pick the path a given input
// would actually trigger, deterministically (no LLM).
// =============================================================================
//
// Pure, browser-safe. The simulator uses this to drive sequential animation:
// the UI receives an ordered list of node ids and lights them up one at a
// time, plus a list of decisions so it can show which branches were skipped.
//
// Strategy:
//   - Walk children in order (depth-first, pre-order: parent then children).
//   - At a flowControl with branches[], pick exactly one branch by evaluating
//     metadata.conditionAst against the scope.
//       * 'if' / 'else_if' / 'ternary' — true → 'then'; false → 'else'.
//       * 'switch' — without per-case ASTs we can't decide; pick 'default'
//         when present, otherwise the first 'case'. Reason: 'unknown'.
//       * Anything else with branches — pick first.
//   - When evaluation is undecidable (UNKNOWN), default to the first branch
//     so animation still has something to show, but flag the decision so the
//     UI can render a "?" badge.
//   - Loops, try, catch, finally — no `branches[]`, just walk children once.
//   - Return / throw / response short-circuits the rest of the current block,
//     just like real JS execution.
// =============================================================================

import type {
  CodeNode,
  FlowControlNode,
  ConditionExpr,
} from '../types/topology';
import { evaluateCondition, type Scope } from './evaluate-condition';

export type WalkDecision = {
  /** flowControl node id where the decision was made */
  nodeId: string;
  /** label of the branch that was taken (e.g. 'then', 'else', 'case', 'default'); null when there were no branches */
  branchLabel: string | null;
  /** outcome of the condition evaluation */
  outcome: 'true' | 'false' | 'unknown' | 'no-branch';
  /** branch labels NOT taken — UI uses these to grey out lanes */
  skippedLabels: string[];
};

export type WalkResult = {
  /** node ids in the order they are reached, parent before children */
  walkOrder: string[];
  /** every flowControl encountered and which branch was selected */
  decisions: WalkDecision[];
  /** true when a return/throw/response was reached and the walk short-circuited */
  terminated: boolean;
};

export function computeWalkOrder(root: CodeNode | undefined, scope: Scope): WalkResult {
  const out: WalkResult = { walkOrder: [], decisions: [], terminated: false };
  if (!root) return out;
  visit(root, scope, out, 0);
  return out;
}

/**
 * Walks a CodeNode tree and records the path the supplied scope would trigger.
 *
 * `depth` tracks how many called-function frames we've descended into:
 *   - depth === 0 ⇒ we're still in the controller (endpoint) frame; a
 *     `return` / `throw` here ends the whole walk because the response is
 *     produced (or the exception propagates out to the client).
 *   - depth >  0 ⇒ we're inside a service/repository call that the controller
 *     made. A `return` there just unwinds that callee; the controller may
 *     still have more statements (e.g. a wrapping `return` after the call).
 *     A `throw` exits the callee too — without try/catch tracking we treat it
 *     as a normal frame exit so the walk continues at the caller, matching
 *     the user's expectation that termination is a controller-layer event.
 *
 * Returns whether the *current frame* exited via return/throw, so the caller
 * (`function` boundary handler) knows to stop iterating that frame's
 * remaining siblings without poisoning the wider walk.
 */
function visit(node: CodeNode, scope: Scope, out: WalkResult, depth: number): { exitedFrame: boolean } {
  if (out.terminated) return { exitedFrame: true };
  out.walkOrder.push(node.id);

  if (node.type === 'return' || node.type === 'throw') {
    if (depth === 0) {
      // Controller-layer terminal — this is the actual response.
      out.terminated = true;
      return { exitedFrame: true };
    }
    // Inside a callee — exit this frame only. Caller continues normally.
    return { exitedFrame: true };
  }

  if (node.type === 'flowControl') {
    const fc = node as FlowControlNode;
    const { branches } = fc.metadata;
    if (branches && branches.length > 0) {
      const decision = pickBranch(fc, scope);
      out.decisions.push(decision);
      const picked = branches.find(b => b.label === decision.branchLabel);
      if (picked) {
        for (const child of picked.children) {
          if (out.terminated) return { exitedFrame: true };
          const r = visit(child, scope, out, depth);
          if (r.exitedFrame) return { exitedFrame: true };
        }
      }
      for (const child of node.children) {
        if (out.terminated) return { exitedFrame: true };
        const r = visit(child, scope, out, depth);
        if (r.exitedFrame) return { exitedFrame: true };
      }
      return { exitedFrame: false };
    }
    // No branches[] (loop / try / catch / finally / labeled): walk children
    // once below.
  }

  // Entering a `function` body bumps depth. When the body finishes (whether
  // by reaching the end or via an inner return/throw) we swallow `exitedFrame`
  // so the caller's frame is not aborted.
  const isFunctionFrame = node.type === 'function';
  const childDepth = isFunctionFrame ? depth + 1 : depth;
  for (const child of node.children) {
    if (out.terminated) return { exitedFrame: true };
    const r = visit(child, scope, out, childDepth);
    if (r.exitedFrame) {
      if (isFunctionFrame) {
        // Function returned — caller continues with its next sibling.
        return { exitedFrame: false };
      }
      return { exitedFrame: true };
    }
  }
  return { exitedFrame: false };
}

function pickBranch(fc: FlowControlNode, scope: Scope): WalkDecision {
  const { kind, conditionAst, branches = [] } = fc.metadata;
  const labels = branches.map(b => b.label);

  // Two-arm conditional: 'if', 'else_if', 'ternary', 'nullish_coalescing',
  // 'optional_chain'. Pick by truthiness of conditionAst.
  if (kind === 'if' || kind === 'else_if' || kind === 'ternary' ||
      kind === 'nullish_coalescing' || kind === 'optional_chain') {
    return pickTwoArm(fc.id, conditionAst, scope, labels);
  }

  // Switch — without per-case ASTs we can't deterministically match. Prefer
  // 'default' when present so the walk lands somewhere meaningful, otherwise
  // pick the first case. The UI can render this as "?".
  if (kind === 'switch') {
    const def = labels.find(l => l === 'default');
    const chosen = def ?? labels[0] ?? null;
    return {
      nodeId: fc.id,
      branchLabel: chosen,
      outcome: 'unknown',
      skippedLabels: labels.filter(l => l !== chosen),
    };
  }

  // Fallback: pick the first labeled branch.
  const chosen = labels[0] ?? null;
  return {
    nodeId: fc.id,
    branchLabel: chosen,
    outcome: 'unknown',
    skippedLabels: labels.filter(l => l !== chosen),
  };
}

function pickTwoArm(
  nodeId: string,
  ast: ConditionExpr | undefined,
  scope: Scope,
  labels: string[],
): WalkDecision {
  // Conventional labels: 'then' (truthy) and 'else' (falsy). We tolerate
  // alternative labels by position: index 0 = truthy, index 1 = falsy.
  const truthyLabel = labels.includes('then') ? 'then' : labels[0] ?? null;
  const falsyLabel  = labels.includes('else') ? 'else' : labels[1] ?? null;

  const result = evaluateCondition(ast, scope);

  if (result === true) {
    return {
      nodeId,
      branchLabel: truthyLabel,
      outcome: 'true',
      skippedLabels: labels.filter(l => l !== truthyLabel),
    };
  }
  if (result === false) {
    // If there's no 'else' branch, the walk still continues past the if; the
    // decision records that nothing was entered.
    if (falsyLabel == null) {
      return { nodeId, branchLabel: null, outcome: 'false', skippedLabels: labels };
    }
    return {
      nodeId,
      branchLabel: falsyLabel,
      outcome: 'false',
      skippedLabels: labels.filter(l => l !== falsyLabel),
    };
  }
  // Unknown — default to the truthy lane so the user sees *something*. The UI
  // surfaces the "?" so the user knows the value of the gate is undefined.
  return {
    nodeId,
    branchLabel: truthyLabel,
    outcome: 'unknown',
    skippedLabels: labels.filter(l => l !== truthyLabel),
  };
}
