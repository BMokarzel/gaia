// =============================================================================
// schema-resolver — expand a TS type name into a recursive ResolvedShape tree.
// =============================================================================
//
// Pure function. Given a type name (e.g. `"CreateUserDto"` or `"User[]"`) and a
// pool of `DataNode`s (typically a service's `globals`), recursively walks the
// type structure to produce a `ResolvedShape`. Stops at primitives, tracks seen
// names to break cycles (DTOs that reference each other), and falls back to
// `unknown` for unresolvable shapes.
//
// Used by:
//   - Endpoint simulator → render request body input form, evaluate branches.
//   - Web UI            → display the full DTO tree alongside the endpoint.
//
// Subset only — see `ResolvedShape` JSDoc in `topology.ts`.
// =============================================================================

import type { DataNode, ResolvedShape, ResolvedField, TypedField } from '../types/topology';

const PRIMITIVE_MAP: Record<string, ResolvedShape & { kind: 'primitive' }> = {
  string:    { kind: 'primitive', type: 'string',    raw: 'string'    },
  number:    { kind: 'primitive', type: 'number',    raw: 'number'    },
  bigint:    { kind: 'primitive', type: 'number',    raw: 'bigint'    },
  boolean:   { kind: 'primitive', type: 'boolean',   raw: 'boolean'   },
  null:      { kind: 'primitive', type: 'null',      raw: 'null'      },
  undefined: { kind: 'primitive', type: 'undefined', raw: 'undefined' },
  void:      { kind: 'primitive', type: 'undefined', raw: 'void'      },
  any:       { kind: 'primitive', type: 'any',       raw: 'any'       },
  unknown:   { kind: 'primitive', type: 'unknown',   raw: 'unknown'   },
  never:     { kind: 'primitive', type: 'unknown',   raw: 'never'     },
  date:      { kind: 'primitive', type: 'date',      raw: 'Date'      },
};

export interface ResolveSchemaContext {
  /** Pool of DataNodes to look up named types in (typically `service.globals`). */
  dataNodes: DataNode[];
}

/**
 * Resolve a TypeScript type expression (as a string) into a ResolvedShape.
 * The third argument tracks names already being expanded so that mutually
 * recursive DTOs (User → Friend → User) terminate as `{ kind: 'cycle' }`.
 */
export function resolveSchema(
  typeExpr: string | undefined,
  ctx: ResolveSchemaContext,
  seen: Set<string> = new Set(),
): ResolvedShape {
  if (!typeExpr) return { kind: 'unknown', raw: '' };
  const expr = typeExpr.trim();
  if (expr.length === 0) return { kind: 'unknown', raw: typeExpr };

  // Strip outer parentheses: `(A | B)` → `A | B`
  const unwrapped = stripOuterParens(expr);

  // Top-level union: split on `|` outside of <>, [], {}, (), '', ""
  const unionParts = splitTopLevel(unwrapped, '|');
  if (unionParts.length > 1) {
    const options = unionParts.map(p => resolveSchema(p, ctx, seen));
    return { kind: 'union', options };
  }

  // Top-level intersection — represented as union of constituent shapes for simplicity.
  // (A full structural merge of two object shapes is out of scope for this subset.)
  const intersectionParts = splitTopLevel(unwrapped, '&');
  if (intersectionParts.length > 1) {
    return { kind: 'unknown', raw: unwrapped };
  }

  const t = unwrapped;

  // Array suffix: `T[]`
  if (t.endsWith('[]')) {
    const inner = t.slice(0, -2).trim();
    return { kind: 'array', element: resolveSchema(inner, ctx, seen) };
  }
  // Generic Array: `Array<T>`, `ReadonlyArray<T>`
  const arrGeneric = /^(?:Readonly)?Array<(.+)>$/s.exec(t);
  if (arrGeneric) {
    return { kind: 'array', element: resolveSchema(arrGeneric[1], ctx, seen) };
  }

  // Promise<T> / Awaited<T> / Readonly<T> — unwrap
  const wrap = /^(?:Promise|Awaited|Readonly)<(.+)>$/s.exec(t);
  if (wrap) return resolveSchema(wrap[1], ctx, seen);

  // Record<string, T> → object with one synthetic field shape (best-effort).
  const recordMatch = /^(?:Record|Partial|Required)<(.+)>$/s.exec(t);
  if (recordMatch) {
    const inner = recordMatch[1];
    if (t.startsWith('Record<')) {
      return { kind: 'unknown', raw: t };
    }
    // Partial<X> / Required<X> → resolve X and (optionally) flip required flags.
    const inner2 = resolveSchema(inner, ctx, seen);
    if (inner2.kind === 'object' && t.startsWith('Partial<')) {
      return { ...inner2, fields: inner2.fields.map(f => ({ ...f, required: false })) };
    }
    if (inner2.kind === 'object' && t.startsWith('Required<')) {
      return { ...inner2, fields: inner2.fields.map(f => ({ ...f, required: true })) };
    }
    return inner2;
  }

  // Literal: 'foo', "foo", `foo`, 42, true, false
  const lit = literalOf(t);
  if (lit !== undefined) return lit;

  // Primitive (case-insensitive for `Date`)
  const primKey = t.toLowerCase();
  if (PRIMITIVE_MAP[primKey]) return PRIMITIVE_MAP[primKey];

  // Inline object literal: { a: string; b?: number }
  if (t.startsWith('{') && t.endsWith('}')) {
    return parseInlineObject(t, ctx, seen);
  }

  // Named reference — look up in the DataNode pool.
  const baseName = stripGenerics(t);
  if (seen.has(baseName)) {
    return { kind: 'cycle', ref: baseName };
  }

  const node = findDataNode(ctx.dataNodes, baseName);
  if (!node) return { kind: 'unknown', raw: t };

  const nextSeen = new Set(seen);
  nextSeen.add(baseName);

  if (node.metadata.kind === 'enum') {
    const values = (node.metadata.fields ?? []).map(f =>
      coerceEnumValue(f.defaultValue ?? f.name)
    );
    return {
      kind: 'enum',
      name: node.name,
      values,
      sourceNodeId: node.id,
    };
  }

  // interface / type / class / object_literal → object shape
  const fields = (node.metadata.fields ?? []).map(f => fieldFromTypedField(f, ctx, nextSeen));
  return {
    kind: 'object',
    name: node.name,
    fields,
    sourceNodeId: node.id,
  };
}

// --- helpers ----------------------------------------------------------------

function fieldFromTypedField(
  f: TypedField,
  ctx: ResolveSchemaContext,
  seen: Set<string>,
): ResolvedField {
  return {
    name: f.name,
    required: f.required,
    shape: resolveSchema(f.type, ctx, seen),
    defaultValue: f.defaultValue,
    description: f.description,
    validation: f.validation,
  };
}

function findDataNode(pool: DataNode[], name: string): DataNode | undefined {
  return pool.find(n => n.name === name);
}

function stripGenerics(t: string): string {
  const lt = t.indexOf('<');
  return lt === -1 ? t : t.slice(0, lt);
}

function stripOuterParens(t: string): string {
  if (!t.startsWith('(') || !t.endsWith(')')) return t;
  // Make sure the matching paren is at the end (avoid stripping `(a) | (b)`)
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0 && i < t.length - 1) return t;
    }
  }
  return stripOuterParens(t.slice(1, -1).trim());
}

/**
 * Split a type expression on `sep` (`|` or `&`) at top level only — respecting
 * nesting in <>, [], {}, (), and ignoring separators inside string literals.
 */
function splitTopLevel(t: string, sep: '|' | '&'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr: '"' | "'" | '`' | null = null;
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '<' || c === '[' || c === '{' || c === '(') depth++;
    else if (c === '>' || c === ']' || c === '}' || c === ')') depth--;
    else if (depth === 0 && c === sep) {
      parts.push(t.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(t.slice(start).trim());
  return parts.filter(p => p.length > 0);
}

function literalOf(t: string): ResolvedShape | undefined {
  if (t === 'true' || t === 'false') return { kind: 'literal', value: t === 'true' };
  if (/^-?\d+(\.\d+)?$/.test(t)) return { kind: 'literal', value: Number(t) };
  if ((t.startsWith("'") && t.endsWith("'") && t.length >= 2) ||
      (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
      (t.startsWith('`') && t.endsWith('`') && t.length >= 2)) {
    return { kind: 'literal', value: t.slice(1, -1) };
  }
  return undefined;
}

function coerceEnumValue(raw: string): string | number {
  const trimmed = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parse a small inline object literal: `{ a: string; b?: number; c: User }`.
 * Best-effort — anything we can't parse falls back to `{ kind: 'unknown' }`.
 */
function parseInlineObject(
  t: string,
  ctx: ResolveSchemaContext,
  seen: Set<string>,
): ResolvedShape {
  const inner = t.slice(1, -1).trim();
  if (inner.length === 0) return { kind: 'object', fields: [] };

  const memberStrs = splitMembers(inner);
  const fields: ResolvedField[] = [];
  for (const m of memberStrs) {
    const colon = findTopLevel(m, ':');
    if (colon === -1) continue;
    let nameRaw = m.slice(0, colon).trim();
    const typeRaw = m.slice(colon + 1).trim();
    let optional = false;
    if (nameRaw.endsWith('?')) {
      optional = true;
      nameRaw = nameRaw.slice(0, -1).trim();
    }
    if (nameRaw.length === 0) continue;
    fields.push({
      name: nameRaw,
      required: !optional,
      shape: resolveSchema(typeRaw, ctx, seen),
    });
  }
  return { kind: 'object', fields };
}

/** Split inline-object members on `;` or `,` at top-level. */
function splitMembers(t: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr: '"' | "'" | '`' | null = null;
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '<' || c === '[' || c === '{' || c === '(') depth++;
    else if (c === '>' || c === ']' || c === '}' || c === ')') depth--;
    else if (depth === 0 && (c === ';' || c === ',')) {
      const s = t.slice(start, i).trim();
      if (s) parts.push(s);
      start = i + 1;
    }
  }
  const last = t.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

function findTopLevel(t: string, target: string): number {
  let depth = 0;
  let inStr: '"' | "'" | '`' | null = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '<' || c === '[' || c === '{' || c === '(') depth++;
    else if (c === '>' || c === ']' || c === '}' || c === ')') depth--;
    else if (depth === 0 && c === target) return i;
  }
  return -1;
}

// =============================================================================
// Endpoint enrichment — populate request.bodySchema / querySchema / paramsSchema
// =============================================================================

import type { EndpointNode } from '../types/topology';

/**
 * Mutates `endpoint.metadata.request` to attach resolved schemas for body,
 * query and params when the corresponding `*Type` field references a DataNode
 * in `dataNodes`. No-op when types are already primitive or unresolvable.
 */
export function attachEndpointSchemas(
  endpoint: EndpointNode,
  dataNodes: DataNode[],
): void {
  const ctx: ResolveSchemaContext = { dataNodes };
  const req = endpoint.metadata.request;
  if (!req) return;

  if (req.bodyType && !req.bodySchema) {
    const shape = resolveSchema(req.bodyType, ctx);
    if (shape.kind !== 'unknown') req.bodySchema = shape;
  }

  // Query: derived from the union of `query[].type` when query is a single typed object.
  // Heuristic: if there's exactly one query field whose type resolves to an object,
  // expose that object as querySchema. Otherwise build a synthetic object from query[].
  if (req.query && req.query.length > 0 && !req.querySchema) {
    req.querySchema = synthesizeFromTypedFields(req.query, ctx);
  }
  if (req.params && req.params.length > 0 && !req.paramsSchema) {
    req.paramsSchema = synthesizeFromTypedFields(req.params, ctx);
  }
}

function synthesizeFromTypedFields(
  fields: TypedField[],
  ctx: ResolveSchemaContext,
): ResolvedShape {
  return {
    kind: 'object',
    fields: fields.map(f => ({
      name: f.name,
      required: f.required,
      shape: resolveSchema(f.type, ctx),
      defaultValue: f.defaultValue,
      description: f.description,
      validation: f.validation,
    })),
  };
}
