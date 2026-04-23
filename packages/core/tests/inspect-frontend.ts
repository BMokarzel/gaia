/**
 * Script de inspeção da extração frontend.
 * Roda: npx tsx tests/inspect-frontend.ts
 * Flags: --json  → raw JSON no final
 *
 * Mostra screens, components e eventos extraídos do fixture react-shop,
 * num formato legível para validação antes de virar gold.
 * Simula o component linking cross-file que o orchestrator faz em produção.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import Parser from 'tree-sitter';
import { extractFrontendNodes } from '../src/extractors/ts/frontend/screen.extractor';
import type { ScreenNode, ComponentNode, FrontendEventNode, FrontendAction } from '../src/types/topology';

const FIXTURE_DIR = join(__dirname, 'fixtures/frontend/react-shop/src');

// ── Load tree-sitter-typescript (TSX grammar) ─────────────────────────────────

const tsModule = require('tree-sitter-typescript');
const tsxLang = tsModule.tsx ?? tsModule;
const parser = new Parser();
parser.setLanguage(tsxLang);

// ── Walk fixture files ────────────────────────────────────────────────────────

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walkDir(full));
    } else if (['.tsx', '.jsx'].includes(extname(entry))) {
      results.push(full);
    }
  }
  return results;
}

const files = walkDir(FIXTURE_DIR);
const allScreens: ScreenNode[] = [];
const allComponents: ComponentNode[] = [];
const allScreenComponentRefs = new Map<string, string[]>();

for (const absPath of files) {
  const content = readFileSync(absPath, 'utf-8');
  const relPath = relative(FIXTURE_DIR, absPath).replace(/\\/g, '/');
  const tree = parser.parse(content);
  const { screens, components, screenComponentRefs } = extractFrontendNodes(tree.rootNode as any, relPath);
  allScreens.push(...screens);
  allComponents.push(...components);
  for (const [screenId, names] of screenComponentRefs) {
    allScreenComponentRefs.set(screenId, names);
  }
}

// ── Simulate orchestrator component linking (cross-file) ──────────────────────

const compByName = new Map<string, ComponentNode>();
for (const comp of allComponents) {
  if (!compByName.has(comp.name)) compByName.set(comp.name, comp);
}

for (const screen of allScreens) {
  const refs = allScreenComponentRefs.get(screen.id) ?? [];
  const attached = new Set(screen.components.map(c => c.name));
  for (const name of refs) {
    if (!attached.has(name)) {
      const comp = compByName.get(name);
      if (comp) { screen.components.push(comp); attached.add(name); }
    }
  }
}

// ── Pretty print ──────────────────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════');
console.log('  FRONTEND EXTRACTION INSPECTION');
console.log('════════════════════════════════════════════════════════\n');

const allAttachedIds = new Set(allScreens.flatMap(s => s.components.map(c => c.id)));
const orphanComponents = allComponents.filter(c => !allAttachedIds.has(c.id));

console.log(`Screens extracted   : ${allScreens.length}`);
console.log(`Components extracted: ${allComponents.length}`);
console.log(`  attached to screen: ${allComponents.length - orphanComponents.length}`);
console.log(`  orphans           : ${orphanComponents.length}\n`);

// ── Screens ───────────────────────────────────────────────────────────────────

if (allScreens.length === 0) {
  console.log('⚠  No screens extracted — check isFrontendFile() path patterns\n');
} else {
  console.log('─── SCREENS ────────────────────────────────────────────\n');
  for (const screen of allScreens) {
    console.log(`▸ ${screen.name}`);
    console.log(`  route    : ${screen.metadata.route ?? '(none)'}`);
    console.log(`  kind     : ${screen.metadata.kind}`);
    console.log(`  framework: ${screen.metadata.framework ?? '(none)'}`);
    console.log(`  authReq  : ${screen.metadata.authRequired}`);
    console.log(`  file     : ${screen.metadata.filePath}`);
    console.log(`  navigates: ${screen.navigatesTo.length > 0 ? screen.navigatesTo.join(', ') : '(none)'}`);
    console.log(`  components: ${screen.components.length}`);

    for (const comp of screen.components) {
      printComponent(comp, 2);
    }
    console.log('');
  }
}

// ── Orphan components ─────────────────────────────────────────────────────────

if (orphanComponents.length > 0) {
  console.log('─── ORPHAN COMPONENTS (no parent screen) ───────────────\n');
  for (const comp of orphanComponents) {
    printComponent(comp, 0);
    console.log('');
  }
}

// ── Component print helper ────────────────────────────────────────────────────

function printComponent(comp: ComponentNode, indent: number): void {
  const pad = '  '.repeat(indent);
  console.log(`${pad}▸ ${comp.name} [${comp.metadata.kind}]  — ${comp.metadata.filePath}`);
  console.log(`${pad}  exported: ${comp.metadata.exported}`);
  if (comp.metadata.hooks?.length) {
    console.log(`${pad}  hooks   : ${comp.metadata.hooks.join(', ')}`);
  }
  if (comp.metadata.state?.local?.length) {
    const state = comp.metadata.state.local.map(f => `${f.name}:${f.type}`).join(', ');
    console.log(`${pad}  state   : ${state}`);
  }
  if (comp.metadata.state?.store) {
    console.log(`${pad}  store   : ${comp.metadata.state.store}`);
  }
  if (comp.metadata.queries?.length) {
    console.log(`${pad}  queries :`);
    for (const q of comp.metadata.queries) {
      console.log(`${pad}    ${q.hookOrMethod}  ${q.method} ${q.path}`);
    }
  }
  if (comp.events?.length) {
    console.log(`${pad}  events  :`);
    for (const ev of comp.events) {
      printEvent(ev, indent + 2);
    }
  }
}

function printEvent(ev: FrontendEventNode, indent: number): void {
  const pad = '  '.repeat(indent);
  console.log(`${pad}▸ ${ev.name}  [${ev.metadata.trigger}]`);
  for (const action of ev.metadata.actions) {
    printAction(action, indent + 1);
  }
}

function printAction(action: FrontendAction, indent: number): void {
  const pad = '  '.repeat(indent);
  switch (action.kind) {
    case 'api_call':     console.log(`${pad}${action.method} ${action.path}`); break;
    case 'navigate':     console.log(`${pad}→ ${action.targetScreenId}`); break;
    case 'state_update': console.log(`${pad}state: ${action.field}`); break;
    case 'analytics':    console.log(`${pad}analytics: ${action.provider}.${action.eventName}`); break;
    case 'side_effect':  console.log(`${pad}side_effect: ${action.description}`); break;
    default:             console.log(`${pad}${(action as any).kind}`); break;
  }
}

// ── Raw JSON ──────────────────────────────────────────────────────────────────

if (process.argv.includes('--json')) {
  console.log('\n─── RAW JSON ────────────────────────────────────────────\n');
  console.log(JSON.stringify({ screens: allScreens, orphanComponents }, null, 2));
}
