import type { FunctionNode, FlowControlNode, CallNode, ReturnNode, DataNode, CodeNode, TypedField } from '../types/topology';

const DECISION_KINDS = new Set([
  'if', 'else_if', 'switch', 'case',
  'for', 'for_of', 'for_in', 'while', 'do_while',
  'catch', 'ternary', 'nullish_coalescing',
]);

/**
 * Computa métricas de complexidade, side effects e shape de retorno
 * para uma FunctionNode cujos children já foram aninhados.
 * Modifica fn.metadata in-place.
 */
export function computeFunctionMetrics(fn: FunctionNode): void {
  const linesOfCode = (fn.location.endLine ?? fn.location.line) - fn.location.line;
  const cyclomatic = 1 + countDecisionNodes(fn.children);

  const allCalls = collectByType<CallNode>(fn.children, 'call');
  const allReturns = collectByType<ReturnNode>(fn.children, 'return');

  const awaitedCalls = allCalls.filter(c => c.metadata.awaited);
  const performsIO = awaitedCalls.length > 0;
  const throwsUnhandled = computeThrowsUnhandled(fn.children, awaitedCalls);
  const inferredReturnShape = inferReturnShape(allReturns, fn.children);

  fn.metadata.complexity = { cyclomatic, linesOfCode };
  fn.metadata.sideEffects = { performsIO, throwsUnhandled };
  if (inferredReturnShape.length > 0) {
    fn.metadata.inferredReturnShape = inferredReturnShape;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function countDecisionNodes(children: CodeNode[]): number {
  let count = 0;
  for (const child of children) {
    if (child.type === 'flowControl') {
      const fc = child as FlowControlNode;
      if (DECISION_KINDS.has(fc.metadata.kind)) count++;
    }
    // recursivo para branches aninhadas no futuro
    if (child.children.length > 0) count += countDecisionNodes(child.children);
  }
  return count;
}

function collectByType<T extends CodeNode>(children: CodeNode[], type: string): T[] {
  const result: T[] = [];
  for (const child of children) {
    if (child.type === type) result.push(child as T);
    if (child.children.length > 0) result.push(...collectByType<T>(child.children, type));
  }
  return result;
}

/**
 * throwsUnhandled = true se há algum CallNode com awaited=true que não está
 * dentro do range de linhas de um FlowControlNode de kind='try'.
 */
function computeThrowsUnhandled(children: CodeNode[], awaitedCalls: CallNode[]): boolean {
  if (awaitedCalls.length === 0) return false;

  const tryBlocks = children
    .filter(c => c.type === 'flowControl' && (c as FlowControlNode).metadata.kind === 'try')
    .map(c => ({ start: c.location.line, end: c.location.endLine ?? c.location.line }));

  if (tryBlocks.length === 0) return true;

  return awaitedCalls.some(call => {
    const line = call.location.line;
    return !tryBlocks.some(t => line >= t.start && line <= t.end);
  });
}

/**
 * Tenta inferir o shape de retorno a partir de return nodes com object literal.
 * Cruza com DataNodes locais para enriquecer tipos além de 'unknown'.
 */
function inferReturnShape(returns: ReturnNode[], children: CodeNode[]): TypedField[] {
  const localVars = collectByType<DataNode>(children, 'data')
    .filter(d => d.metadata.scope === 'local' && d.metadata.dataType);
  const varTypeMap = new Map(localVars.map(d => [d.name, d.metadata.dataType as string]));

  for (const ret of returns) {
    const value = ret.metadata.value;
    if (!value || !value.trimStart().startsWith('{')) continue;
    // Só parsear se o objeto parece completo (tem '}')
    if (!value.includes('}')) continue;

    const fields: TypedField[] = [];
    const RESERVED = new Set(['return', 'true', 'false', 'null', 'undefined', 'new', 'this']);

    for (const line of value.split('\n')) {
      // Remove trailing comma e espaços
      const trimmed = line.trim().replace(/,$/, '').trim();
      if (!trimmed || trimmed === '{' || trimmed === '}') continue;

      // Propriedade regular: key: value
      const regularMatch = /^(\w+)\s*:/.exec(trimmed);
      if (regularMatch) {
        const name = regularMatch[1];
        if (!RESERVED.has(name) && !fields.some(f => f.name === name)) {
          fields.push({ name, type: varTypeMap.get(name) ?? 'unknown', required: true });
        }
        continue;
      }

      // Shorthand property: só o identificador na linha (ex: averageAge)
      const shorthandMatch = /^(\w+)$/.exec(trimmed);
      if (shorthandMatch) {
        const name = shorthandMatch[1];
        if (!RESERVED.has(name) && !fields.some(f => f.name === name)) {
          fields.push({ name, type: varTypeMap.get(name) ?? 'unknown', required: true });
        }
      }
    }

    if (fields.length > 0) return fields;
  }

  return [];
}
