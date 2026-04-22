import Parser from 'tree-sitter';
import type { LanguageParser, ParseResult } from './base';
import { emptyResult } from './base';
import type { SourceFile } from '../core/walker';
import type { AnalysisContext } from '../types/topology';
import { extractSpringEndpoints } from '../extractors/java/endpoint/spring.extractor';
import { extractJPAOperations } from '../extractors/java/db/jpa.extractor';
import { extractJavaFunctions } from '../extractors/java/function.extractor';
import { extractJavaFlowControl } from '../extractors/java/flow.extractor';
import { extractJavaLogs } from '../extractors/java/log.extractor';
import { extractJavaCalls } from '../extractors/java/call.extractor';
import { extractJavaEvents } from '../extractors/java/event.extractor';
import { extractJavaHttpClients } from '../extractors/java/http-client.extractor';
import { serviceId as computeServiceId } from '../utils/id';

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
      const path = file.relativePath;
      const serviceId = computeServiceId(context.repoPath);

      const codeNodes: any[] = [];
      const databases: any[] = [];
      const brokers: any[] = [];

      const springResult = extractSpringEndpoints(root as any, path);
      codeNodes.push(...springResult.endpoints, ...springResult.functions);

      const jpaResult = extractJPAOperations(root as any, path);
      codeNodes.push(...jpaResult.dbNodes);
      if (jpaResult.database.tables.length > 0) {
        databases.push(jpaResult.database);
      }

      // HTTP client calls (ExternalCallNodes for cross-service merge)
      codeNodes.push(...extractJavaHttpClients(root as any, path));

      codeNodes.push(...extractJavaFunctions(root as any, path));
      codeNodes.push(...extractJavaFlowControl(root as any, path));
      codeNodes.push(...extractJavaLogs(root as any, path));
      codeNodes.push(...extractJavaCalls(root as any, path));

      const eventResult = extractJavaEvents(root as any, path, serviceId);
      codeNodes.push(...eventResult.eventNodes);
      brokers.push(...eventResult.brokers);

      return { codeNodes, databases, brokers };
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
