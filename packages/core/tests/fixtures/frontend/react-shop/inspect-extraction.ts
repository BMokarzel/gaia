/**
 * Script de inspeção da extração frontend.
 * Roda: npx tsx tests/fixtures/frontend/react-shop/inspect-extraction.ts
 *
 * Mostra screens, components e eventos extraídos do fixture react-shop,
 * num formato legível para validação antes de virar gold.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import Parser from 'tree-sitter';
import { extractFrontendNodes } from '../../src/extractors/ts/frontend/screen.extractor';

const FIXTURE_DIR = join(__dirname, 'src');

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
const allScreens: any[] = [];
const allComponents: any[] = [];

for (const absPath of files) {
  const content = readFileSync(absPath, 'utf-8');
  const relPath = relative(FIXTURE_DIR, absPath).replace(/\\/g, '/');
  const tree = parser.parse(content);
  const { screens, components } = extractFrontendNodes(tree.rootNode as any, relPath);
  allScreens.push(...screens);
  allComponents.push(...components);
}

// ── Pretty print ──────────────────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════');
console.log('  FRONTEND EXTRACTION INSPECTION');
console.log('════════════════════════════════════════════════════════\n');

console.log(`Screens extracted  : ${allScreens.length}`);
console.log(`Components extracted: ${allComponents.length}\n`);

// ── Screens ───────────────────────────────────────────────────────────────────

if (allScreens.length === 0) {
  console.log('⚠  No screens extracted — check isFrontendFile() path patterns\n');
} else {
  console.log('─── SCREENS ────────────────────────────────────────────\n');
  for (const screen of allScreens) {
    console.log(`▸ ${screen.name}`);
    console.log(`  id       : ${screen.id}`);
    console.log(`  route    : ${screen.metadata.route ?? '(none)'}`);
    console.log(`  kind     : ${screen.metadata.kind}`);
    console.log(`  framework: ${screen.metadata.framework ?? '(none)'}`);
    console.log(`  authReq  : ${screen.metadata.authRequired}`);
    console.log(`  file     : ${screen.metadata.filePath}`);
    console.log(`  navigates: ${screen.navigatesTo.length > 0 ? screen.navigatesTo.join(', ') : '(none)'}`);
    console.log(`  components: ${screen.components.length}`);

    for (const comp of screen.components) {
      console.log(`\n    ▸ component: ${comp.name} [${comp.metadata.kind}]`);
      console.log(`      id      : ${comp.id}`);
      console.log(`      exported: ${comp.metadata.exported}`);

      if (comp.metadata.hooks?.length) {
        console.log(`      hooks   : ${comp.metadata.hooks.join(', ')}`);
      }
      if (comp.metadata.state?.local?.length) {
        const state = comp.metadata.state.local.map((f: any) => `${f.name}:${f.type}`).join(', ');
        console.log(`      state   : ${state}`);
      }
      if (comp.metadata.state?.store) {
        console.log(`      store   : ${comp.metadata.state.store}`);
      }
      if (comp.metadata.queries?.length) {
        console.log(`      queries :`);
        for (const q of comp.metadata.queries) {
          console.log(`        ${q.hookOrMethod}  ${q.method} ${q.path}`);
        }
      }
      if (comp.events?.length) {
        console.log(`      events  :`);
        for (const ev of comp.events) {
          console.log(`        ▸ ${ev.name}  [trigger: ${ev.metadata.trigger}]`);
          for (const action of ev.metadata.actions) {
            switch (action.kind) {
              case 'api_call':
                console.log(`            api_call   ${action.method} ${action.path}`);
                break;
              case 'navigate':
                console.log(`            navigate   → ${action.targetScreenId}`);
                break;
              case 'state_update':
                console.log(`            state_upd  ${action.field}`);
                break;
              case 'analytics':
                console.log(`            analytics  ${action.provider}.${action.eventName}`);
                break;
              case 'side_effect':
                console.log(`            side_eff   ${action.description}`);
                break;
              default:
                console.log(`            ${(action as any).kind}`);
            }
          }
        }
      }
    }
    console.log('');
  }
}

// ── Orphan components (not in any screen) ────────────────────────────────────

const screenCompIds = new Set(allScreens.flatMap((s: any) => s.components.map((c: any) => c.id)));
const orphanComponents = allComponents.filter(c => !screenCompIds.has(c.id));

if (orphanComponents.length > 0) {
  console.log('─── COMPONENTS (not attached to a screen) ──────────────\n');
  for (const comp of orphanComponents) {
    console.log(`▸ ${comp.name} [${comp.metadata.kind}]  file: ${comp.metadata.filePath}`);
    if (comp.metadata.hooks?.length) {
      console.log(`  hooks  : ${comp.metadata.hooks.join(', ')}`);
    }
    if (comp.events?.length) {
      for (const ev of comp.events) {
        console.log(`  event  : ${ev.name} [${ev.metadata.trigger}]`);
        for (const action of ev.metadata.actions) {
          console.log(`    ${(action as any).kind}  ${(action as any).method ?? ''} ${(action as any).path ?? (action as any).targetScreenId ?? (action as any).field ?? ''}`);
        }
      }
    }
  }
  console.log('');
}

// ── Raw JSON (optional, full detail) ─────────────────────────────────────────

if (process.argv.includes('--json')) {
  console.log('\n─── RAW JSON ────────────────────────────────────────────\n');
  console.log(JSON.stringify({ screens: allScreens, orphanComponents }, null, 2));
}
