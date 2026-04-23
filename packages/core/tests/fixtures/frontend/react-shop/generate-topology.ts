/**
 * generate-topology.ts
 *
 * Reads all .tsx files from src/, runs them through extractFrontendNodes,
 * simulates orchestrator component linking (screenComponentRefs), then
 * builds and writes a minimal valid SystemTopology (schemaVersion: "3.0.0")
 * to topology.json next to this script.
 *
 * Run:
 *   cd C:/Users/User/Desktop/tree/packages/core
 *   npx tsx tests/fixtures/frontend/react-shop/generate-topology.ts
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, extname, relative } from 'path';
import Parser from 'tree-sitter';
import { extractFrontendNodes } from '../../../../src/extractors/ts/frontend/screen.extractor';
import type { SystemTopology, ServiceNode, ScreenNode, ComponentNode } from '../../../../src/types/topology';

// ── Tree-sitter TSX grammar ────────────────────────────────────────────────────

const tsModule = require('tree-sitter-typescript');
const tsxLang = tsModule.tsx ?? tsModule;
const parser = new Parser();
parser.setLanguage(tsxLang);

// ── Paths ─────────────────────────────────────────────────────────────────────

const SCRIPT_DIR = __dirname;
const SRC_DIR = join(SCRIPT_DIR, 'src');
const OUTPUT_PATH = join(SCRIPT_DIR, 'topology.json');

// ── Walk src/ recursively for .tsx files ──────────────────────────────────────

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walkDir(full));
    } else if (extname(entry) === '.tsx') {
      results.push(full);
    }
  }
  return results;
}

const tsxFiles = walkDir(SRC_DIR);
console.log(`Found ${tsxFiles.length} .tsx file(s):`);
for (const f of tsxFiles) {
  console.log('  ', relative(SCRIPT_DIR, f).replace(/\\/g, '/'));
}

// ── Extract frontend nodes from each file ─────────────────────────────────────

const allScreens: ScreenNode[] = [];
const allComponents: ComponentNode[] = [];
// Combined screenComponentRefs across all files
const screenComponentRefs = new Map<string, string[]>();

for (const absPath of tsxFiles) {
  const content = readFileSync(absPath, 'utf-8');
  // Use path relative to SRC_DIR so that isPageFile / isScreenFile patterns work
  const relPath = relative(SRC_DIR, absPath).replace(/\\/g, '/');
  const tree = parser.parse(content);
  const result = extractFrontendNodes(tree.rootNode as any, relPath);

  allScreens.push(...result.screens);
  allComponents.push(...result.components);

  for (const [screenId, names] of result.screenComponentRefs) {
    const existing = screenComponentRefs.get(screenId) ?? [];
    screenComponentRefs.set(screenId, [...new Set([...existing, ...names])]);
  }
}

console.log(`\nExtracted: ${allScreens.length} screen(s), ${allComponents.length} component(s)`);

// ── Simulate orchestrator: link components to screens (screenComponentRefs) ───
// Build a name→ComponentNode index from all extracted components

const componentByName = new Map<string, ComponentNode>();
for (const comp of allComponents) {
  componentByName.set(comp.name, comp);
}

for (const screen of allScreens) {
  const refs = screenComponentRefs.get(screen.id) ?? [];
  for (const compName of refs) {
    const comp = componentByName.get(compName);
    if (comp && !screen.components.some(c => c.id === comp.id)) {
      screen.components.push(comp);
    }
  }
}

// ── Build minimal ServiceNode ─────────────────────────────────────────────────

const service: ServiceNode = {
  id: 'svc:react-shop',
  type: 'service',
  name: 'React Shop',
  code: 'RSH',
  metadata: {
    kind: 'frontend',
    framework: 'react',
    language: 'typescript',
    description: `Frontend service with ${allScreens.length} screen(s) extracted from src/`,
  },
  endpoints: [],
  functions: [],
  globals: [],
  dependencies: [],
};

// ── Build SystemTopology ──────────────────────────────────────────────────────

const topology: SystemTopology = {
  schemaVersion: '3.0.0',
  analyzedAt: new Date().toISOString(),
  services: [service],
  screens: allScreens,
  databases: [],
  storages: [],
  brokers: [],
  edges: [],
  errorFlow: {
    paths: [],
    globalHandlers: [],
  },
  observability: {
    logs: [],
    telemetry: [],
    coverage: {
      endpointsWithTracing: 0,
      endpointsTotal: 0,
      dbQueriesWithSpans: 0,
      dbQueriesTotal: 0,
      errorsWithLogging: 0,
      errorsTotal: 0,
      screensWithAnalytics: 0,
      screensTotal: allScreens.length,
    },
  },
  diagnostics: [],
};

// ── Write topology.json ───────────────────────────────────────────────────────

writeFileSync(OUTPUT_PATH, JSON.stringify(topology, null, 2), 'utf-8');
console.log(`\nTopology written to: ${OUTPUT_PATH}`);
console.log(`Screens in topology : ${topology.screens.length}`);
console.log(`Services in topology: ${topology.services.length}`);
