/**
 * Helpers internos de manipulação de SyntaxNode tree-sitter para o
 * TsAstWalker. Subconjunto do que existe em @topology/core/utils/ast-helpers
 * — duplicado aqui de propósito para preservar autonomia do pacote.
 */

import type { SyntaxNode } from './ts-parser-adapter';

export function fieldText(node: SyntaxNode, field: string): string | null {
  return node.childForFieldName(field)?.text ?? null;
}

export function namedChildOfType(node: SyntaxNode, type: string): SyntaxNode | null {
  return node.namedChildren.find(c => c.type === type) ?? null;
}

export function namedChildrenOfType(node: SyntaxNode, type: string): SyntaxNode[] {
  return node.namedChildren.filter(c => c.type === type);
}

export function findFirstDescendant(node: SyntaxNode, type: string): SyntaxNode | null {
  for (const child of node.children) {
    if (child.type === type) return child;
    const inner = findFirstDescendant(child, type);
    if (inner) return inner;
  }
  return null;
}

export function findParentOfType(node: SyntaxNode, types: string[]): SyntaxNode | null {
  let cur: SyntaxNode | null = node.parent;
  while (cur) {
    if (types.includes(cur.type)) return cur;
    cur = cur.parent;
  }
  return null;
}

export function decoratorsOf(node: SyntaxNode): SyntaxNode[] {
  // Decorators são filhos diretos OU irmãos nomeados anteriores no pai
  // (depende do nó: parameters têm decorator como filho; classes/methods
  // têm decorator como irmão anterior dentro de class_body).
  const direct = node.children.filter(c => c.type === 'decorator');
  if (direct.length) return direct;

  const parent = node.parent;
  if (!parent) return [];
  const sibs = parent.namedChildren;
  const idx = sibs.indexOf(node);
  const out: SyntaxNode[] = [];
  for (let i = idx - 1; i >= 0; i--) {
    if (sibs[i].type === 'decorator') out.unshift(sibs[i]);
    else break;
  }
  return out;
}

export function decoratorName(decorator: SyntaxNode): string {
  const call = decorator.children.find(c => c.type === 'call_expression');
  if (call) {
    const fn = call.childForFieldName('function');
    if (fn) return fn.text;
  }
  const ident = decorator.children.find(c => c.type === 'identifier');
  return ident?.text ?? '';
}

export function decoratorFirstStringArg(decorator: SyntaxNode): string | null {
  const call = decorator.children.find(c => c.type === 'call_expression');
  if (!call) return null;
  const args = call.childForFieldName('arguments');
  if (!args) return null;
  const first = args.namedChildren[0];
  if (!first) return null;
  if (first.type === 'string') return first.text.replace(/^['"`]|['"`]$/g, '');
  if (first.type === 'template_string') return first.text.replace(/^`|`$/g, '');
  return null;
}

export function decoratorAllArgs(decorator: SyntaxNode): string[] {
  const call = decorator.children.find(c => c.type === 'call_expression');
  if (!call) return [];
  const args = call.childForFieldName('arguments');
  if (!args) return [];
  return args.namedChildren.map(c => c.text.trim());
}

export function isAsync(node: SyntaxNode): boolean {
  return node.children.some(c => c.type === 'async');
}

export function visibilityOf(node: SyntaxNode): 'public' | 'private' | 'protected' {
  const acc = node.children.find(c => c.type === 'accessibility_modifier');
  if (acc?.text === 'private') return 'private';
  if (acc?.text === 'protected') return 'protected';
  return 'public';
}

export function isStatic(node: SyntaxNode): boolean {
  return node.children.some(c => c.type === 'static');
}

export function isReadonly(node: SyntaxNode): boolean {
  return node.children.some(c => c.type === 'readonly');
}

export function returnTypeText(node: SyntaxNode): string | null {
  const rt = node.childForFieldName('return_type');
  if (!rt) return null;
  return rt.text.replace(/^:\s*/, '').trim() || null;
}

export function paramTypeText(node: SyntaxNode): string | null {
  const t = node.childForFieldName('type');
  if (!t) return null;
  return t.text.replace(/^:\s*/, '').trim() || null;
}

export function calleeOf(callExpr: SyntaxNode): string {
  const fn = callExpr.childForFieldName('function');
  return fn?.text ?? callExpr.text.split('(')[0];
}

export function argTextsOf(callExpr: SyntaxNode): string[] {
  const args = callExpr.childForFieldName('arguments');
  if (!args) return [];
  return args.namedChildren.map(c => c.text.trim());
}

export function isAwaitedCall(callExpr: SyntaxNode): boolean {
  return callExpr.parent?.type === 'await_expression';
}

export function isChainedCall(callExpr: SyntaxNode): boolean {
  // call_expression cujo function é member_expression cujo object é
  // outra call_expression.
  const fn = callExpr.childForFieldName('function');
  if (!fn || fn.type !== 'member_expression') return false;
  const obj = fn.childForFieldName('object');
  return obj?.type === 'call_expression';
}

export function strLiteralValue(node: SyntaxNode): string | null {
  if (node.type === 'string') return node.text.replace(/^['"`]|['"`]$/g, '');
  if (node.type === 'template_string') return node.text.replace(/^`|`$/g, '');
  return null;
}
