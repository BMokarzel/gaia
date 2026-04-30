/**
 * `code-graph validate <graph.json>`
 *
 * Valida estruturalmente o JSON via `deserializeGraph` (já checa schema
 * version e re-monta os índices). Em A.2, será trocado por validação
 * contra JSON Schema. Por ora reporta:
 *   - schema version
 *   - counts
 *   - integridade básica: toda edge aponta para elements existentes
 */

import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { deserializeGraph, GRAPH_SCHEMA_VERSION, type SerializedGraph } from '../serializer';
import { validateGraphJSON } from '../schema-validate';

export interface ValidateArgs {
  graphFile: string;
}

export async function runValidate(args: ValidateArgs): Promise<{ ok: boolean; report: ValidationReport }> {
  const path = isAbsolute(args.graphFile) ? args.graphFile : resolve(process.cwd(), args.graphFile);
  const raw = await readFile(path, 'utf8');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    const report: ValidationReport = {
      ok: false,
      schemaVersion: null,
      elements: 0,
      edges: 0,
      issues: [`JSON inválido: ${String(err)}`],
    };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return { ok: false, report };
  }

  const issues: string[] = [];
  let elements = 0;
  let edges = 0;
  let schemaVersion: string | null = null;

  // 1. Validação estrutural (espelha JSON Schema)
  const structural = validateGraphJSON(json);
  if (!structural.ok) {
    for (const i of structural.issues) issues.push(`${i.path}: ${i.message}`);
  }

  // 2. Validação semântica via deserializeGraph (re-monta índices)
  try {
    const graph = deserializeGraph(json as SerializedGraph);
    elements = graph.size.elements;
    edges = graph.size.edges;
    schemaVersion = (json as { graphSchemaVersion?: string }).graphSchemaVersion ?? GRAPH_SCHEMA_VERSION;
  } catch (err) {
    issues.push(String(err));
  }

  const ok = issues.length === 0;
  const report: ValidationReport = { ok, schemaVersion, elements, edges, issues };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return { ok, report };
}

export interface ValidationReport {
  ok: boolean;
  schemaVersion: string | null;
  elements: number;
  edges: number;
  issues: string[];
}
