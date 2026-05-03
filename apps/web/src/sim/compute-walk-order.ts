// =============================================================================
// compute-walk-order — walk a CodeNode tree and pick the path a given input
// would actually trigger, deterministically (no LLM).
// =============================================================================
//
// Mirror of packages/core/src/sim/compute-walk-order.ts. Kept here because
// @topology/core has tree-sitter native deps that can't bundle for browser.
// Keep the two files in sync.
// =============================================================================

import type {
  CodeNode,
  FlowControlNode,
  ConditionExpr,
} from '@topology/core';
import { evaluateCondition, type Scope } from './evaluate-condition';

export type WalkDecision = {
  nodeId: string;
  branchLabel: string | null;
  outcome: 'true' | 'false' | 'unknown' | 'no-branch';
  skippedLabels: string[];
};

export type WalkResult = {
  walkOrder: string[];
  decisions: WalkDecision[];
  terminated: boolean;
};

export function computeWalkOrder(root: CodeNode | undefined, scope: Scope): WalkResult {
  const out: WalkResult = { walkOrder: [], decisions: [], terminated: false };
  if (!root) return out;
  visit(root, scope, out, 0);
  return out;
}

/**
 * `depth` counts called-function frames. Only `return`/`throw` at depth 0
 * (controller layer) terminates the walk — deeper returns just unwind the
 * current callee so the controller can keep walking afterwards.
 */
function visit(node: CodeNode, scope: Scope, out: WalkResult, depth: number): { exitedFrame: boolean } {
  if (out.terminated) return { exitedFrame: true };
  out.walkOrder.push(node.id);

  if (node.type === 'return' || node.type === 'throw') {
    if (depth === 0) {
      out.terminated = true;
      return { exitedFrame: true };
    }
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
  }

  const isFunctionFrame = node.type === 'function';
  const childDepth = isFunctionFrame ? depth + 1 : depth;
  for (const child of node.children) {
    if (out.terminated) return { exitedFrame: true };
    const r = visit(child, scope, out, childDepth);
    if (r.exitedFrame) {
      if (isFunctionFrame) return { exitedFrame: false };
      return { exitedFrame: true };
    }
  }
  return { exitedFrame: false };
}

function pickBranch(fc: FlowControlNode, scope: Scope): WalkDecision {
  const { kind, conditionAst, branches = [] } = fc.metadata;
  const labels = branches.map(b => b.label);

  if (kind === 'if' || kind === 'else_if' || kind === 'ternary' ||
      kind === 'nullish_coalescing' || kind === 'optional_chain') {
    return pickTwoArm(fc.id, conditionAst, scope, labels);
  }

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
  return {
    nodeId,
    branchLabel: truthyLabel,
    outcome: 'unknown',
    skippedLabels: labels.filter(l => l !== truthyLabel),
  };
}
