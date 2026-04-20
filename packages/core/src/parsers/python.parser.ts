import Parser from 'tree-sitter';
import type { LanguageParser, ParseResult } from './base';
import { emptyResult } from './base';
import type { SourceFile } from '../core/walker';
import type { AnalysisContext } from '../types/topology';
import { extractFastAPIEndpoints } from '../extractors/python/endpoint/fastapi.extractor';
import { extractDjangoEndpoints } from '../extractors/python/endpoint/django.extractor';
import { extractPythonFunctions } from '../extractors/python/function.extractor';
import { extractPythonFlowControl } from '../extractors/python/flow.extractor';
import { extractPythonLogs } from '../extractors/python/log.extractor';
import { extractPythonCalls } from '../extractors/python/call.extractor';
import { extractPythonEvents } from '../extractors/python/event.extractor';
import { extractSQLAlchemyOperations } from '../extractors/python/db/sqlalchemy.extractor';
import { serviceId as computeServiceId } from '../utils/id';

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
      const serviceId = computeServiceId(context.repoPath);

      const codeNodes: any[] = [];
      const databases: any[] = [];
      const brokers: any[] = [];

      // FastAPI
      codeNodes.push(...extractFastAPIEndpoints(root as any, path));

      // Django
      codeNodes.push(...extractDjangoEndpoints(root as any, path));

      // Functions, flow, logs, calls
      codeNodes.push(...extractPythonFunctions(root as any, path));
      codeNodes.push(...extractPythonFlowControl(root as any, path));
      codeNodes.push(...extractPythonLogs(root as any, path));
      codeNodes.push(...extractPythonCalls(root as any, path));

      // Events
      const eventResult = extractPythonEvents(root as any, path, serviceId);
      codeNodes.push(...eventResult.eventNodes);
      brokers.push(...eventResult.brokers);

      // SQLAlchemy
      const sqlResult = extractSQLAlchemyOperations(root as any, path);
      codeNodes.push(...sqlResult.dbNodes);
      if (sqlResult.database.tables.length > 0) {
        databases.push(sqlResult.database);
      }

      return { codeNodes, databases, brokers };
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
