/**
 * Script temporário: dump do AST bruto (tree-sitter) do sample-api
 * Uso: npx tsx dump-ast.ts
 */
import Parser from 'tree-sitter';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';

const TARGET = 'C:/Users/User/Desktop/sample-api/src';

function loadLang(name: string): unknown {
  try {
    const mod = require(name);
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

function serializeNode(node: Parser.SyntaxNode): unknown {
  const result: Record<string, unknown> = {
    type: node.type,
    text: node.childCount === 0 ? node.text : undefined,
    start: { row: node.startPosition.row, column: node.startPosition.column },
    end:   { row: node.endPosition.row,   column: node.endPosition.column },
  };
  if (node.childCount > 0) {
    result.children = node.children.map(serializeNode);
  }
  // Remove undefined keys
  for (const k of Object.keys(result)) {
    if (result[k] === undefined) delete result[k];
  }
  return result;
}

function walkDir(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walkDir(full));
    } else if (['.ts', '.tsx'].includes(extname(entry))) {
      files.push(full);
    }
  }
  return files;
}

const tsModule = loadLang('tree-sitter-typescript') as any;
const tsLang = tsModule?.typescript ?? tsModule;
const tsxLang = tsModule?.tsx ?? tsModule;

if (!tsLang) {
  console.error('tree-sitter-typescript não encontrado');
  process.exit(1);
}

const parser = new Parser();
const output: Record<string, unknown> = {};

for (const filePath of walkDir(TARGET)) {
  const ext = extname(filePath);
  const lang = (ext === '.tsx') ? tsxLang : tsLang;
  parser.setLanguage(lang);
  const content = readFileSync(filePath, 'utf-8');
  const tree = parser.parse(content);
  const relPath = relative(TARGET, filePath).replace(/\\/g, '/');
  output[relPath] = serializeNode(tree.rootNode);
}

console.log(JSON.stringify(output, null, 2));
