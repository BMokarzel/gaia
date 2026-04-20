import Parser from 'tree-sitter';
import type { LanguageParser, ParseResult } from './base';
import { emptyResult, mergeResults } from './base';
import type { SourceFile } from '../core/walker';
import type { AnalysisContext, CodeNode } from '../types/topology';

import { extractNestEndpoints } from '../extractors/ts/endpoint/nest.extractor';
import { extractExpressEndpoints } from '../extractors/ts/endpoint/express.extractor';
import { extractFastifyEndpoints } from '../extractors/ts/endpoint/fastify.extractor';
import { extractFunctions } from '../extractors/ts/function.extractor';
import { extractPrismaOperations } from '../extractors/ts/db/prisma.extractor';
import { extractTypeORMOperations } from '../extractors/ts/db/typeorm.extractor';
import { extractSequelizeOperations } from '../extractors/ts/db/sequelize.extractor';
import { extractEvents } from '../extractors/ts/event.extractor';
import { extractFlowControl } from '../extractors/ts/flow.extractor';
import { extractCalls } from '../extractors/ts/call.extractor';
import { extractLogs } from '../extractors/ts/log.extractor';
import { extractTelemetry } from '../extractors/ts/telemetry.extractor';
import { extractDataNodes } from '../extractors/ts/data.extractor';
import { extractFrontendNodes } from '../extractors/ts/frontend/screen.extractor';
import { extractAssignments } from '../extractors/ts/assignment.extractor';
import { serviceId as computeServiceId } from '../utils/id';

// Lazy load das grammars para não crashar se não estiverem instaladas
function loadLanguage(name: string): unknown {
  try {
    const mod = require(name);
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

export class TypeScriptParser implements LanguageParser {
  readonly supportedExtensions = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx'];

  private parser: Parser | null = null;
  private tsLang: unknown = null;
  private tsxLang: unknown = null;
  private jsLang: unknown = null;

  private initParser(): Parser | null {
    if (this.parser) return this.parser;

    try {
      const tsModule = loadLanguage('tree-sitter-typescript');
      if (tsModule) {
        this.tsLang = (tsModule as any).typescript ?? tsModule;
        this.tsxLang = (tsModule as any).tsx ?? tsModule;
      }
      this.parser = new Parser();
      return this.parser;
    } catch {
      return null;
    }
  }

  supports(file: SourceFile): boolean {
    return this.supportedExtensions.includes(file.extension);
  }

  parse(file: SourceFile, context: AnalysisContext): ParseResult {
    const parser = this.initParser();
    if (!parser) return emptyResult();

    const lang = file.extension === '.tsx' || file.extension === '.jsx'
      ? this.tsxLang
      : this.tsLang;

    if (!lang) return emptyResult();

    try {
      parser.setLanguage(lang as Parameters<typeof parser.setLanguage>[0]);
      const tree = parser.parse(file.content);
      const root = tree.rootNode;

      const isFrontend = isFrontendFile(file);
      const serviceId = computeServiceId(context.repoPath);

      const codeNodes: CodeNode[] = [];
      const databases = [];
      const brokers = [];

      if (isFrontend) {
        // Arquivos de frontend: extrai screens, components, eventos
        const { screens, components } = extractFrontendNodes(root as any, file.relativePath);
        context.screens.push(...screens);
        // Components são parte das screens; não viram CodeNodes diretos
        return emptyResult();
      }

      // Endpoints por framework
      const nestResult = extractNestEndpoints(root as any, file.relativePath);
      const expressEndpoints = extractExpressEndpoints(root as any, file.relativePath);
      const fastifyEndpoints = extractFastifyEndpoints(root as any, file.relativePath);

      codeNodes.push(...nestResult.endpoints);
      codeNodes.push(...nestResult.functions);
      codeNodes.push(...expressEndpoints);
      codeNodes.push(...fastifyEndpoints);

      // Funções (evita duplicar endpoints já extraídos)
      const endpointLines = new Set([
        ...nestResult.endpoints.map(e => e.location.line),
      ]);
      const functions = extractFunctions(root as any, file.relativePath)
        .filter(f => !endpointLines.has(f.location.line));
      codeNodes.push(...functions);

      // DB operations
      const prismaResult = extractPrismaOperations(root as any, file.relativePath);
      if (prismaResult.dbNodes.length > 0) {
        codeNodes.push(...prismaResult.dbNodes);
        databases.push(prismaResult.database);
      }

      const typeormResult = extractTypeORMOperations(root as any, file.relativePath);
      if (typeormResult.dbNodes.length > 0) {
        codeNodes.push(...typeormResult.dbNodes);
        databases.push(typeormResult.database);
      }

      const sequelizeResult = extractSequelizeOperations(root as any, file.relativePath);
      if (sequelizeResult.dbNodes.length > 0) {
        codeNodes.push(...sequelizeResult.dbNodes);
        databases.push(sequelizeResult.database);
      }

      // Eventos e brokers
      const eventResult = extractEvents(root as any, file.relativePath, serviceId);
      codeNodes.push(...eventResult.eventNodes);
      brokers.push(...eventResult.brokers);

      // Chamadas de função/método
      codeNodes.push(...extractCalls(root as any, file.relativePath));

      // Atribuições (reatribuições de variáveis)
      codeNodes.push(...extractAssignments(root as any, file.relativePath));

      // Controle de fluxo
      codeNodes.push(...extractFlowControl(root as any, file.relativePath));

      // Logs
      codeNodes.push(...extractLogs(root as any, file.relativePath));

      // Telemetria
      codeNodes.push(...extractTelemetry(root as any, file.relativePath));

      // Dados (interfaces, types, enums, imports — só módulo)
      codeNodes.push(...extractDataNodes(root as any, file.relativePath));

      return { codeNodes, databases, brokers };
    } catch (err) {
      context.diagnostics.push({
        level: 'error',
        message: `TypeScript parser error in ${file.relativePath}: ${(err as Error).message}`,
        location: { file: file.relativePath, line: 1, column: 0 },
      });
      return emptyResult();
    }
  }
}

/** Verifica se o arquivo é de frontend (React/Vue/Svelte components) */
function isFrontendFile(file: SourceFile): boolean {
  const path = file.relativePath.toLowerCase();

  // Extensões JSX/TSX são sempre frontend
  if (file.extension === '.tsx' || file.extension === '.jsx') return true;

  // Padrões de diretório comuns de frontend
  if (/\/(pages|screens|views|components|ui|app)\//i.test(path)) return true;

  // Padrões de nome que indicam component/screen
  const name = path.split('/').pop() ?? '';
  if (/Page|Screen|View|Component|Modal|Dialog|Drawer/i.test(name)) return true;

  return false;
}
