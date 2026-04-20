import Parser from 'tree-sitter';
import type { LanguageParser, ParseResult } from './base';
import { emptyResult } from './base';
import type { SourceFile } from '../core/walker';
import type { AnalysisContext } from '../types/topology';
import { extractGoEndpoints } from '../extractors/go/endpoint/gin.extractor';
import { extractGoFunctions } from '../extractors/go/function.extractor';
import { extractGoFlowControl } from '../extractors/go/flow.extractor';
import { extractGoLogs } from '../extractors/go/log.extractor';
import { extractGoCalls } from '../extractors/go/call.extractor';
import { extractGoEvents } from '../extractors/go/event.extractor';
import { extractGORMOperations } from '../extractors/go/db/gorm.extractor';
import { serviceId as computeServiceId } from '../utils/id';

function loadLanguage(name: string): unknown {
  try {
    const mod = require(name);
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

export class GoParser implements LanguageParser {
  readonly supportedExtensions = ['.go'];

  private parser: Parser | null = null;
  private lang: unknown = null;

  private init(): Parser | null {
    if (this.parser) return this.parser;
    this.lang = loadLanguage('tree-sitter-go');
    if (!this.lang) return null;
    this.parser = new Parser();
    return this.parser;
  }

  supports(file: SourceFile): boolean {
    return file.extension === '.go';
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

      // Endpoints (Gin, Chi, Mux)
      codeNodes.push(...extractGoEndpoints(root as any, path));

      // Functions, flow, logs, calls
      codeNodes.push(...extractGoFunctions(root as any, path));
      codeNodes.push(...extractGoFlowControl(root as any, path));
      codeNodes.push(...extractGoLogs(root as any, path));
      codeNodes.push(...extractGoCalls(root as any, path));

      // Events
      const eventResult = extractGoEvents(root as any, path, serviceId);
      codeNodes.push(...eventResult.eventNodes);
      brokers.push(...eventResult.brokers);

      // GORM
      const gormResult = extractGORMOperations(root as any, path);
      codeNodes.push(...gormResult.dbNodes);
      if (gormResult.database.tables.length > 0) {
        databases.push(gormResult.database);
      }

      return { codeNodes, databases, brokers };
    } catch (err) {
      context.diagnostics.push({
        level: 'error',
        message: `Go parser error in ${file.relativePath}: ${(err as Error).message}`,
        location: { file: file.relativePath, line: 1, column: 0 },
      });
      return emptyResult();
    }
  }
}
