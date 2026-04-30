/**
 * Adapter que carrega tree-sitter-typescript de forma lazy. Mantemos o
 * acesso ao Parser localizado em um único arquivo para que o resto do
 * walker fique testável sem o binding nativo carregado (mockável).
 */

import Parser from 'tree-sitter';

export type SyntaxNode = Parser.SyntaxNode;

let cachedParser: Parser | null = null;
let cachedTsLang: unknown = null;
let cachedTsxLang: unknown = null;
let initFailed = false;

function tryLoad(name: string): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(name);
    return (mod as { default?: unknown }).default ?? mod;
  } catch {
    return null;
  }
}

function init(): boolean {
  if (cachedParser) return true;
  if (initFailed) return false;

  const tsModule = tryLoad('tree-sitter-typescript') as
    | { typescript?: unknown; tsx?: unknown }
    | null;
  if (!tsModule) {
    initFailed = true;
    return false;
  }
  cachedTsLang = tsModule.typescript ?? tsModule;
  cachedTsxLang = tsModule.tsx ?? tsModule;
  cachedParser = new Parser();
  return true;
}

export function isAvailable(): boolean {
  return init();
}

export function parseTypeScript(source: string, extension: string): SyntaxNode | null {
  if (!init() || !cachedParser) return null;
  const lang = extension === '.tsx' || extension === '.jsx' ? cachedTsxLang : cachedTsLang;
  if (!lang) return null;

  cachedParser.setLanguage(lang as Parameters<typeof cachedParser.setLanguage>[0]);
  const tree = cachedParser.parse(source);
  return tree.rootNode;
}
