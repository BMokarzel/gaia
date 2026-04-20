import Parser from 'tree-sitter';
import type { LanguageParser, ParseResult } from './base';
import { emptyResult } from './base';
import type { SourceFile } from '../core/walker';
import type { AnalysisContext } from '../types/topology';
import { extractFastAPIEndpoints } from '../extractors/python/endpoint/fastapi.extractor';
import { extractDjangoEndpoints } from '../extractors/python/endpoint/django.extractor';

function loadLanguage(name: string): unknown {
  try {
    const mod = require(name);
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

export class PythonParser implements LanguageParser {
  readonly supportedExtensions = ['.py'];

  private parser: Parser | null = null;
  private lang: unknown = null;

  private init(): Parser | null {
    if (this.parser) return this.parser;
    this.lang = loadLanguage('tree-sitter-python');
    if (!this.lang) return null;
    this.parser = new Parser();
    return this.parser;
  }

  supports(file: SourceFile): boolean {
    return file.extension === '.py';
  }

  parse(file: SourceFile, context: AnalysisContext): ParseResult {
    const parser = this.init();
    if (!parser || !this.lang) return emptyResult();

    try {
      parser.setLanguage(this.lang as any);
      const tree = parser.parse(file.content);
      const root = tree.rootNode;
      const path = file.relativePath;

      const codeNodes: any[] = [];

      // FastAPI
      const fastApiEndpoints = extractFastAPIEndpoints(root as any, path);
      codeNodes.push(...fastApiEndpoints);

      // Django
      const djangoEndpoints = extractDjangoEndpoints(root as any, path);
      codeNodes.push(...djangoEndpoints);

      return { codeNodes, databases: [], brokers: [] };
    } catch (err) {
      context.diagnostics.push({
        level: 'error',
        message: `Python parser error in ${file.relativePath}: ${(err as Error).message}`,
        location: { file: file.relativePath, line: 1, column: 0 },
      });
      return emptyResult();
    }
  }
}
