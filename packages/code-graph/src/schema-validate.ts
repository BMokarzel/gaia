/**
 * Validador estrutural standalone — espelha as restrições do JSON Schema
 * em `schema/element-graph.schema.json`. Mantemos esta validação dentro
 * do pacote (zero deps) para que consumidores possam validar sem trazer
 * Ajv/AJV. Para validação 100% canônica use o JSON Schema diretamente.
 */

import { ALL_ELEMENT_KINDS } from './element';
import { ALL_EDGE_KINDS } from './edge';
import { GRAPH_SCHEMA_VERSION } from './serializer';

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const ELEMENT_KIND_SET = new Set<string>(ALL_ELEMENT_KINDS);
const EDGE_KIND_SET = new Set<string>(ALL_EDGE_KINDS);
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export function validateGraphJSON(data: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!isObject(data)) {
    return fail('', 'payload deve ser objeto');
  }

  // graphSchemaVersion
  const version = (data as Record<string, unknown>).graphSchemaVersion;
  if (typeof version !== 'string' || !SEMVER_RE.test(version)) {
    issues.push({
      path: 'graphSchemaVersion',
      message: `versão inválida (esperado semver, atual ${GRAPH_SCHEMA_VERSION})`,
    });
  } else {
    const [major] = version.split('.');
    const [expectedMajor] = GRAPH_SCHEMA_VERSION.split('.');
    if (major !== expectedMajor) {
      issues.push({
        path: 'graphSchemaVersion',
        message: `major version incompatível: ${version} vs ${GRAPH_SCHEMA_VERSION}`,
      });
    }
  }

  const elements = (data as Record<string, unknown>).elements;
  const edges = (data as Record<string, unknown>).edges;
  if (!Array.isArray(elements)) {
    issues.push({ path: 'elements', message: 'deve ser array' });
  }
  if (!Array.isArray(edges)) {
    issues.push({ path: 'edges', message: 'deve ser array' });
  }

  if (issues.length) return { ok: false, issues };

  const ids = new Set<string>();
  for (let i = 0; i < (elements as unknown[]).length; i++) {
    const el = (elements as unknown[])[i];
    const path = `elements[${i}]`;
    if (!isObject(el)) {
      issues.push({ path, message: 'deve ser objeto' });
      continue;
    }
    const e = el as Record<string, unknown>;
    if (typeof e.id !== 'string' || !e.id) issues.push({ path: `${path}.id`, message: 'string obrigatória' });
    else if (ids.has(e.id)) issues.push({ path: `${path}.id`, message: `id duplicado: ${e.id}` });
    else ids.add(e.id);

    if (typeof e.kind !== 'string' || !ELEMENT_KIND_SET.has(e.kind)) {
      issues.push({ path: `${path}.kind`, message: `kind inválido: ${String(e.kind)}` });
    }

    if (!isObject(e.location)) {
      issues.push({ path: `${path}.location`, message: 'objeto obrigatório' });
    } else {
      const loc = e.location as Record<string, unknown>;
      for (const key of ['file', 'startLine', 'startCol', 'endLine', 'endCol']) {
        if (loc[key] === undefined) {
          issues.push({ path: `${path}.location.${key}`, message: 'obrigatório' });
        }
      }
      if (loc.file !== undefined && typeof loc.file !== 'string') {
        issues.push({ path: `${path}.location.file`, message: 'deve ser string' });
      }
    }

    if (!isObject(e.meta)) {
      issues.push({ path: `${path}.meta`, message: 'objeto obrigatório' });
    }
  }

  const edgeIds = new Set<string>();
  for (let i = 0; i < (edges as unknown[]).length; i++) {
    const ed = (edges as unknown[])[i];
    const path = `edges[${i}]`;
    if (!isObject(ed)) {
      issues.push({ path, message: 'deve ser objeto' });
      continue;
    }
    const e = ed as Record<string, unknown>;
    if (typeof e.id !== 'string' || !e.id) issues.push({ path: `${path}.id`, message: 'string obrigatória' });
    else if (edgeIds.has(e.id)) issues.push({ path: `${path}.id`, message: `id duplicado: ${e.id}` });
    else edgeIds.add(e.id);

    if (typeof e.from !== 'string' || !e.from) issues.push({ path: `${path}.from`, message: 'string obrigatória' });
    else if (!ids.has(e.from)) issues.push({ path: `${path}.from`, message: `aponta para id inexistente: ${e.from}` });

    if (typeof e.to !== 'string' || !e.to) issues.push({ path: `${path}.to`, message: 'string obrigatória' });
    else if (!ids.has(e.to)) issues.push({ path: `${path}.to`, message: `aponta para id inexistente: ${e.to}` });

    if (typeof e.kind !== 'string' || !EDGE_KIND_SET.has(e.kind)) {
      issues.push({ path: `${path}.kind`, message: `kind inválido: ${String(e.kind)}` });
    }
  }

  return { ok: issues.length === 0, issues };
}

// ──────────────────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(path: string, message: string): ValidationResult {
  return { ok: false, issues: [{ path, message }] };
}
