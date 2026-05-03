// =============================================================================
// build-form-fields — flatten a ResolvedShape into a list of UI form fields
// =============================================================================
//
// Used by the WalkPathPanel to render a generated input form from the
// endpoint's resolved request schemas (bodySchema / querySchema / paramsSchema).
//
// Strategy: depth-first traversal that produces dotted field paths
// (`user.address.city`), so the form's flat state can be re-assembled into a
// nested object via `setByPath` when feeding the simulator.
//
// We deliberately keep this small: arrays render as a single JSON textarea
// (simulator users rarely need to construct deeply nested arrays interactively),
// and unions render as a select of the discriminator literals when possible,
// else as JSON.
// =============================================================================

import type { ResolvedShape } from '@topology/core';

export type FormFieldKind =
  | 'string' | 'number' | 'boolean' | 'date'
  | 'enum'                  // string select
  | 'json'                  // free JSON textarea (arrays, complex unions, unknown)
  | 'literal';              // single fixed literal (display only)

export interface FormField {
  /** Dotted path: 'user.address.city'. Empty for the root. */
  path: string;
  label: string;
  kind: FormFieldKind;
  required: boolean;
  options?: Array<string | number | boolean | null>;   // for enum/union-of-literals
  raw?: string;                                         // primitive raw type for the hint
  description?: string;
  defaultValue?: string;
}

export interface BuildOptions {
  /** Path prefix prepended to every produced field (e.g. 'body', 'query'). */
  rootPath?: string;
  /** Max nesting depth before collapsing to a JSON field. */
  maxDepth?: number;
}

export function buildFormFields(shape: ResolvedShape | undefined, opts: BuildOptions = {}): FormField[] {
  if (!shape) return [];
  const fields: FormField[] = [];
  const rootPath = opts.rootPath ?? '';
  walk(shape, rootPath, opts.rootPath ?? '(root)', true, fields, 0, opts.maxDepth ?? 4);
  return fields;
}

function walk(
  shape: ResolvedShape,
  path: string,
  label: string,
  required: boolean,
  out: FormField[],
  depth: number,
  maxDepth: number,
): void {
  if (depth > maxDepth) {
    out.push({ path, label, kind: 'json', required });
    return;
  }

  switch (shape.kind) {
    case 'primitive': {
      const kind: FormFieldKind =
        shape.type === 'boolean' ? 'boolean'
      : shape.type === 'number'  ? 'number'
      : shape.type === 'date'    ? 'date'
      : shape.type === 'null' || shape.type === 'undefined' ? 'json'
      : 'string';
      out.push({ path, label, kind, required, raw: shape.raw });
      return;
    }
    case 'literal': {
      out.push({
        path, label, kind: 'literal', required,
        options: [shape.value as string | number | boolean],
      });
      return;
    }
    case 'enum': {
      out.push({
        path, label, kind: 'enum', required,
        options: shape.values,
        raw: shape.name,
      });
      return;
    }
    case 'union': {
      // Union of literals (and optionally null) → enum-style select.
      const literalValues: Array<string | number | boolean | null> = [];
      let allLiteralOrNull = true;
      for (const opt of shape.options) {
        if (opt.kind === 'literal') literalValues.push(opt.value as string | number | boolean);
        else if (opt.kind === 'primitive' && opt.type === 'null') literalValues.push(null);
        else { allLiteralOrNull = false; break; }
      }
      if (allLiteralOrNull && literalValues.length > 0) {
        out.push({ path, label, kind: 'enum', required, options: literalValues });
        return;
      }
      // Heterogeneous union: surface as JSON.
      out.push({ path, label, kind: 'json', required });
      return;
    }
    case 'object': {
      // Each field becomes a row; nested objects produce dotted paths.
      for (const f of shape.fields) {
        const childPath = path ? `${path}.${f.name}` : f.name;
        walk(f.shape, childPath, f.name, f.required, out, depth + 1, maxDepth);
      }
      return;
    }
    case 'array':
    case 'cycle':
    case 'unknown':
    default:
      out.push({ path, label, kind: 'json', required });
      return;
  }
}

// ----- runtime helpers --------------------------------------------------------

/** Set a value on a nested object by dotted path, mutating in place. */
export function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  if (!path) return;
  const parts = path.split('.');
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Coerce a string from an <input> into the typed form expected by `evaluateCondition`.
 * Empty strings on optional fields become `undefined` so the field is treated as absent.
 */
export function coerceInputValue(field: FormField, raw: string): unknown {
  if (raw === '' && !field.required) return undefined;
  switch (field.kind) {
    case 'boolean':
      return raw === 'true' || raw === '1' || raw === 'on';
    case 'number': {
      const n = Number(raw);
      return Number.isNaN(n) ? undefined : n;
    }
    case 'enum': {
      // Enum value type may be number or boolean — try to match.
      for (const opt of field.options ?? []) {
        if (String(opt) === raw) return opt;
      }
      return raw;
    }
    case 'json':
      try { return JSON.parse(raw); } catch { return raw; }
    case 'literal':
      return field.options?.[0];
    case 'date':
    case 'string':
    default:
      return raw;
  }
}
