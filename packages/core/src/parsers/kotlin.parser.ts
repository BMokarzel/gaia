import Parser from 'tree-sitter';
import type { LanguageParser, ParseResult } from './base';
import { emptyResult } from './base';
import type { SourceFile } from '../core/walker';
import type { AnalysisContext } from '../types/topology';
import { extractKotlinSpringEndpoints } from '../extractors/kotlin/endpoint/spring.extractor';
import { extractKotlinHttpClients } from '../extractors/kotlin/http-client.extractor';
import { extractKotlinFlowControl } from '../extractors/kotlin/flow.extractor';
import { extractKotlinCalls } from '../extractors/kotlin/call.extractor';
import { extractKotlinLogs } from '../extractors/kotlin/log.extractor';

function loadLanguage(name: string): unknown {
  try {
    const mod = require(name);
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

export class KotlinParser implements LanguageParser {
  readonly supportedExtensions = ['.kt', '.kts'];

  private parser: Parser | null = null;
  private lang: unknown = null;

  private init(): Parser | null {
    if (this.parser) return this.parser;
    this.lang = loadLanguage('tree-sitter-kotlin');
    if (!this.lang) return null;
    this.parser = new Parser();
    return this.parser;
  }

  supports(file: SourceFile): boolean {
    return ['.kt', '.kts'].includes(file.extension);
  }

  parse(file: SourceFile, context: AnalysisContext): ParseResult {
    const parser = this.init();
    if (!parser || !this.lang) return emptyResult();

    try {
      parser.setLanguage(this.lang as any);
      const tree = parser.parse(file.content);
      const root = tree.rootNode;

      const codeNodes: any[] = [];

      const springResult = extractKotlinSpringEndpoints(root as any, file.relativePath);
      codeNodes.push(...springResult.endpoints, ...springResult.functions);

      // HTTP client calls (ExternalCallNodes for cross-service merge)
      codeNodes.push(...extractKotlinHttpClients(root as any, file.relativePath));

      // Flow control, calls, logs
      codeNodes.push(...extractKotlinFlowControl(root as any, file.relativePath));
      codeNodes.push(...extractKotlinCalls(root as any, file.relativePath));
      codeNodes.push(...extractKotlinLogs(root as any, file.relativePath));

      return { codeNodes, databases: [], brokers: [] };
    } catch (err) {
      context.diagnostics.push({
        level: 'error',
        message: `Kotlin parser error in ${file.relativePath}: ${(err as Error).message}`,
        location: { file: file.relativePath, line: 1, column: 0 },
      });
      return emptyResult();
    }
  }
}
