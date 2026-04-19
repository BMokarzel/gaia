// dump-ast.js — serializa o AST bruto do tree-sitter para cada .ts em src/
const fs = require('fs');
const path = require('path');
const Parser = require('tree-sitter');
const TypeScript = require('tree-sitter-typescript').typescript;

const parser = new Parser();
parser.setLanguage(TypeScript);

function serializeNode(node) {
  const obj = {
    type: node.type,
    named: node.isNamed,
    start: { row: node.startPosition.row + 1, col: node.startPosition.column },
    end: { row: node.endPosition.row + 1, col: node.endPosition.column },
  };
  if (!node.isNamed || node.childCount === 0) {
    obj.text = node.text.length > 120 ? node.text.slice(0, 120) + '…' : node.text;
  }
  if (node.childCount > 0) {
    obj.children = node.children.map(serializeNode);
  }
  return obj;
}

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...walkDir(full));
    else if (e.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

const srcDir = path.resolve(__dirname, 'src');
const files = walkDir(srcDir);
const result = {};

for (const file of files) {
  const rel = path.relative(srcDir, file).replace(/\\/g, '/');
  const source = fs.readFileSync(file, 'utf8');
  const tree = parser.parse(source);
  result[rel] = serializeNode(tree.rootNode);
  console.log(`parsed: ${rel}`);
}

const outPath = path.resolve(__dirname, 'src-ast.json');
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(`\nAST dumped to: ${outPath}  (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB)`);
