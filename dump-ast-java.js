// dump-ast-java.js — serializa o AST bruto do tree-sitter-java para cada .java nos fixtures
const fs = require('fs');
const path = require('path');
const Parser = require('tree-sitter');
const Java = require('tree-sitter-java');

const parser = new Parser();
parser.setLanguage(Java);

function serializeNode(node, depth = 0) {
  const indent = '  '.repeat(depth);
  const pos = `[${node.startPosition.row + 1}:${node.startPosition.column}-${node.endPosition.row + 1}:${node.endPosition.column}]`;
  const name = node.isNamed ? node.type : `"${node.type}"`;

  let line = `${indent}${name} ${pos}`;

  if (node.childCount === 0 && node.text.length <= 80) {
    line += `  →  ${JSON.stringify(node.text)}`;
  }

  const children = node.children.map(c => serializeNode(c, depth + 1));
  return children.length > 0
    ? line + '\n' + children.join('\n')
    : line;
}

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...walkDir(full));
    else if (e.name.endsWith('.java')) files.push(full);
  }
  return files;
}

const fixturesDir = path.resolve(__dirname, 'packages/core/tests/fixtures');
const files = walkDir(fixturesDir);

let output = '';

for (const file of files) {
  const rel = path.relative(fixturesDir, file).replace(/\\/g, '/');
  const source = fs.readFileSync(file, 'utf8');
  const tree = parser.parse(source);

  output += `${'='.repeat(80)}\n`;
  output += `FILE: ${rel}\n`;
  output += `${'='.repeat(80)}\n\n`;
  output += serializeNode(tree.rootNode) + '\n\n';

  console.log(`parsed: ${rel}`);
}

const outPath = path.resolve(process.env.USERPROFILE || process.env.HOME, 'Desktop', 'java-ast.txt');
fs.writeFileSync(outPath, output, 'utf8');
const size = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`\nAST dumped to: ${outPath}  (${size} KB)`);
