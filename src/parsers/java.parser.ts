import Parser from 'tree-sitter';
import type { LanguageParser, ParseResult } from './base';
import { emptyResult } from './base';
import type { SourceFile } from '../core/walker';
import type { AnalysisContext } from '../types/topology';
import { extractSpringEndpoints } from '../extractors/java/endpoint/spring.extractor';
import { extractJPAOperations } from '../extractors/java/db/jpa.extractor';

function loadLanguage(name: string): unknown {
  try {
    const mod = require(name);
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

export class JavaParser implements LanguageParser {
  readonly supportedExtensions = ['.java'];

  private parser: Parser | null = null;
  private lang: unknown = null;

  private init(): Parser | null {
    if (this.parser) return this.parser;
    this.lang = loadLanguage('tree-sitter-java');
    if (!this.lang) return null;
    this.parser = new Parser();
    return this.parser;
  }

  supports(file: SourceFile): boolean {
    return file.extension === '.java';
  }

  parse(file: SourceFile, context: AnalysisContext): ParseResult {
    const parser = this.init();
    if (!parser || !this.lang) return emptyResult();

    try {
      parser.setLanguage(this.lang as any);
      const tree = parser.parse(file.content);
      const root = tree.rootNode;

      const codeNodes: any[] = [];
      const databases: any[] = [];

      const springResult = extractSpringEndpoints(root as any, file.relativePath);
      codeNodes.push(...springResult.endpoints, ...springResult.functions);

      const jpaResult = extractJPAOperations(root as any, file.relativePath);
      codeNodes.push(...jpaResult.dbNodes);
      if (jpaResult.database.tables.length > 0) {
        databases.push(jpaResult.database);
      }

      return { codeNodes, databases, brokers: [] };
    } catch (err) {
      context.diagnostics.push({
        level: 'error',
        message: `Java parser error in ${file.relativePath}: ${(err as Error).message}`,
        location: { file: file.relativePath, line: 1, column: 0 },
      });
      return emptyResult();
    }
  }
}
