import type { AnalysisContext, SystemTopology, LogNode, TelemetryNode, CodeNode, ServiceNode, ComponentNode } from '../types/topology';
import type { ServiceBoundary } from './walker';
import type { Logger } from '../logging/types';
import { NullLogger } from '../logging/null-logger';
import { walkRepository, detectServiceBoundaries } from './walker';
import { detectTechStack } from './detector';
import { TypeScriptParser } from '../parsers/typescript.parser';
import { JavaParser } from '../parsers/java.parser';
import { PythonParser } from '../parsers/python.parser';
import { KotlinParser } from '../parsers/kotlin.parser';
import { SwiftParser } from '../parsers/swift.parser';
import { GoParser } from '../parsers/go.parser';
import { RustParser } from '../parsers/rust.parser';
import { CSharpParser } from '../parsers/csharp.parser';
import type { LanguageParser } from '../parsers/base';
import { buildServiceNode } from '../builders/service.builder';
import { mergeDatabases, buildDatabaseFromHint } from '../builders/database.builder';
import { mergeBrokers, buildBrokerFromHint } from '../builders/broker.builder';
import { buildEdges } from '../builders/edge.builder';
import { buildErrorFlowMap } from '../builders/error-flow.builder';
import { serviceId } from '../utils/id';
import { detectUnused } from '../analysis/unused';
import { runCrossServiceMerge } from '../analysis/service-merger';
import { validateTopology } from '../analysis/topology-validator';
import type { ExternalCallNode } from '../types/topology';

export interface AnalysisOptions {
  /** Ignora arquivos de teste */
  skipTests?: boolean;
  /** Inclui análise de frontend */
  includeFrontend?: boolean;
  /** Callback de progresso (texto simples para UI — continua funcionando independente do logger) */
  onProgress?: (message: string) => void;
  /** Logger estruturado. Default: NullLogger */
  logger?: Logger;
}

const PARSERS: LanguageParser[] = [
  new TypeScriptParser(),
  new JavaParser(),
  new PythonParser(),
  new KotlinParser(),
  new SwiftParser(),
  new GoParser(),
  new RustParser(),
  new CSharpParser(),
];

/**
 * Pipeline principal de análise de um repositório.
 * Produz um SystemTopology completo a partir de um path de repositório.
 */
export async function analyzeRepository(
  repoPath: string,
  options: AnalysisOptions = {},
): Promise<SystemTopology> {
  const {
    skipTests = true,
    includeFrontend = true,
    onProgress = () => {},
    logger: rawLogger = NullLogger,
  } = options;

  const log = rawLogger.child({ component: 'core.orchestrator' });

  const context: AnalysisContext = {
    repoPath,
    services: [],
    databases: new Map(),
    brokers: new Map(),
    storages: new Map(),
    screens: [],
    edges: [],
    diagnostics: [],
    nodeIndex: new Map(),
    frontendComponents: [],
    screenComponentRefs: new Map(),
  };

  // 1. Detecta boundaries de serviços (monorepo vs single service)
  onProgress('Detecting service boundaries...');
  log.info('Detecting service boundaries', { repoPath });
  const boundaries = detectServiceBoundaries(repoPath);
  onProgress(`Found ${boundaries.length} service(s)`);
  log.info('Service boundaries detected', { count: boundaries.length });

  // 2. Para cada boundary, analisa os arquivos
  for (const boundary of boundaries) {
    onProgress(`Analyzing service: ${boundary.name}`);
    log.info('Analyzing service', { service: boundary.name, path: boundary.rootPath });
    await analyzeService(boundary, context, { skipTests, includeFrontend, onProgress, logger: rawLogger });
  }

  // 2b. Link frontend components to screens (cross-file)
  linkFrontendComponents(context);

  // 2c. Fix service kind for frontend services (screens present, no endpoints)
  for (const service of context.services) {
    if (service.endpoints.length === 0 && service.metadata.kind === 'backend') {
      const hasScreens = context.screens.some(s => s.serviceId === service.id);
      if (hasScreens) (service.metadata as any).kind = 'frontend';
    }
  }

  // 3. Consolida databases e brokers de todos os serviços
  const allDatabases = Array.from(context.databases.values());
  const allBrokers = Array.from(context.brokers.values());
  log.debug('Resources consolidated', { databases: allDatabases.length, brokers: allBrokers.length });

  // 4. Atualiza ServiceDependencies baseado nos databases/brokers encontrados
  for (const service of context.services) {
    enrichServiceDependencies(service, allDatabases, allBrokers);
  }

  // 5. Constrói edges globais
  onProgress('Building edges...');
  log.debug('Building edges');
  const edges = buildEdges(context.services, allDatabases, allBrokers);
  log.debug('Edges built', { count: edges.length });

  // 5b. Detecção de código não utilizado
  onProgress('Detecting unused code...');
  detectUnused(context.services, edges, context.diagnostics);

  // 5c. Cross-service merge: resolve ExternalCallNodes to EndpointNodes
  onProgress('Resolving cross-service calls...');
  const externalCalls = collectExternalCallNodes(context.services);
  if (externalCalls.length > 0) {
    const { edges: mergeEdges } = await runCrossServiceMerge(context.services, externalCalls);
    edges.push(...mergeEdges);
    log.debug('Cross-service merge complete', { resolved: mergeEdges.length, total: externalCalls.length });
  }

  // 5d. Topology validation (deterministic layers 1–3)
  onProgress('Validating topology...');
  const validationDiags = validateTopology({
    schemaVersion: '3.0.0',
    analyzedAt: new Date().toISOString(),
    services: context.services,
    databases: allDatabases,
    storages: Array.from(context.storages.values()),
    brokers: allBrokers,
    screens: context.screens,
    edges,
    errorFlow: { paths: [], globalHandlers: [] },
    observability: { logs: [], telemetry: [], coverage: { endpointsWithTracing: 0, endpointsTotal: 0, dbQueriesWithSpans: 0, dbQueriesTotal: 0, errorsWithLogging: 0, errorsTotal: 0, screensWithAnalytics: 0, screensTotal: 0 } },
    diagnostics: [],
  });
  context.diagnostics.push(...validationDiags);
  log.debug('Topology validation complete', { issues: validationDiags.length });

  // 6. Constrói error flow map
  onProgress('Mapping error flows...');
  const errorFlow = buildErrorFlowMap(context.services);

  // 7. Coleta telemetria e logs
  const { logs, telemetry } = collectObservability(context.services);

  // 8. Calcula coverage
  const coverage = calculateCoverage(context.services, telemetry);

  const topology: SystemTopology = {
    schemaVersion: '3.0.0',
    analyzedAt: new Date().toISOString(),
    services: context.services,
    databases: allDatabases,
    storages: Array.from(context.storages.values()),
    brokers: allBrokers,
    screens: context.screens,
    edges,
    errorFlow,
    observability: {
      logs,
      telemetry,
      coverage,
    },
    diagnostics: context.diagnostics,
  };

  const errorCount = context.diagnostics.filter(d => d.level === 'error').length;
  const warnCount  = context.diagnostics.filter(d => d.level === 'warning').length;
  log.info('Analysis complete', {
    services: context.services.length,
    edges: edges.length,
    diagnostics: { errors: errorCount, warnings: warnCount },
  });

  return topology;
}

async function analyzeService(
  boundary: ServiceBoundary,
  context: AnalysisContext,
  options: Required<AnalysisOptions>,
): Promise<void> {
  const { skipTests, includeFrontend, onProgress, logger: parentLogger } = options;
  const log = parentLogger.child({ component: 'core.service', service: boundary.name });

  // Detecta stack tecnológica
  const stack = detectTechStack(boundary);
  log.debug('Stack detected', { language: stack.language, framework: stack.framework });

  // Walk nos arquivos do serviço
  const files = walkRepository(boundary.rootPath, {
    skipTests,
    extensions: includeFrontend ? undefined : excludeFrontendExtensions(),
  });

  onProgress(`  ${files.length} files found in ${boundary.name}`);
  log.info('Files found', { count: files.length, service: boundary.name });

  const allCodeNodes: CodeNode[] = [];
  const serviceDatabases: ReturnType<typeof buildDatabaseFromHint>[] = [];
  const serviceBrokers: ReturnType<typeof buildBrokerFromHint>[] = [];

  // Parseia cada arquivo com o parser adequado
  // Temporarily override context.repoPath with the boundary path so parsers
  // compute the correct service ID for topics/events
  const savedRepoPath = context.repoPath;
  context.repoPath = boundary.rootPath;

  for (const file of files) {
    const parser = PARSERS.find(p => p.supports(file));
    if (!parser) continue;

    try {
      const result = parser.parse(file, context);
      allCodeNodes.push(...result.codeNodes);

      // Acumula databases
      for (const db of result.databases) {
        const existing = context.databases.get(db.metadata.connectionAlias);
        if (!existing) {
          context.databases.set(db.metadata.connectionAlias, db);
        } else {
          // Merge tables
          for (const table of db.tables) {
            const existingTable = existing.tables.find(
              t => t.name.toLowerCase() === table.name.toLowerCase()
            );
            if (!existingTable) {
              existing.tables.push(table);
            }
          }
        }
      }

      // Acumula brokers
      for (const broker of result.brokers) {
        const existing = context.brokers.get(broker.metadata.connectionAlias);
        if (!existing) {
          context.brokers.set(broker.metadata.connectionAlias, broker);
        } else {
          for (const topic of broker.metadata.topics) {
            const existingTopic = existing.metadata.topics.find(t => t.name === topic.name);
            if (!existingTopic) {
              existing.metadata.topics.push(topic);
            } else {
              // Merge producers and consumers
              for (const p of topic.producers) {
                if (!existingTopic.producers.includes(p)) existingTopic.producers.push(p);
              }
              for (const c of topic.consumers) {
                if (!existingTopic.consumers.includes(c)) existingTopic.consumers.push(c);
              }
            }
          }
        }
      }
    } catch (err) {
      const error = err as Error;
      log.warn('Parser error', { file: file.relativePath, error: error.message });
      context.diagnostics.push({
        level: 'warning',
        message: `Failed to parse ${file.relativePath}: ${error.message}`,
        location: { file: file.relativePath, line: 1, column: 0 },
      });
    }
  }

  // Restore original repoPath
  context.repoPath = savedRepoPath;

  // Adiciona databases da stack que ainda não foram detectados no código
  for (const hint of stack.databaseHints) {
    if (!context.databases.has(hint.alias)) {
      const db = buildDatabaseFromHint(hint.alias, hint.engine, hint.orm);
      context.databases.set(hint.alias, db);
    }
  }

  // Adiciona brokers da stack
  for (const hint of stack.brokerHints) {
    if (!context.brokers.has(hint.alias)) {
      const broker = buildBrokerFromHint(hint.alias, hint.engine);
      context.brokers.set(hint.alias, broker);
    }
  }

  // Constrói ServiceNode
  const service = buildServiceNode(boundary, stack, allCodeNodes);
  context.services.push(service);

  // Indexa nós para resolução de edges
  for (const node of allCodeNodes) {
    context.nodeIndex.set(node.id, node as any);
  }
}

function enrichServiceDependencies(
  service: ServiceNode,
  databases: ReturnType<typeof buildDatabaseFromHint>[],
  brokers: ReturnType<typeof buildBrokerFromHint>[],
): void {
  // Infere dependências a partir dos dbProcess nodes
  const dbIds = new Set<string>();
  const brokerIds = new Set<string>();

  function walkNodes(nodes: CodeNode[]): void {
    for (const node of nodes) {
      if (node.type === 'dbProcess') {
        dbIds.add((node as any).metadata.databaseId);
      }
      if (node.type === 'event') {
        const channel = (node as any).metadata.channel;
        if (channel) {
          const broker = brokers.find(b => b.metadata.connectionAlias === channel);
          if (broker) brokerIds.add(broker.id);
        }
      }
    }
  }

  walkNodes(service.endpoints as CodeNode[]);
  walkNodes(service.functions as CodeNode[]);

  for (const dbId of dbIds) {
    const alreadyLinked = service.dependencies.some(d => d.id === dbId);
    if (!alreadyLinked) {
      service.dependencies.push({
        id: dbId,
        targetKind: 'database',
        callKind: 'sync',
        critical: true,
      });
    }
  }

  for (const brokerId of brokerIds) {
    const alreadyLinked = service.dependencies.some(d => d.id === brokerId);
    if (!alreadyLinked) {
      service.dependencies.push({
        id: brokerId,
        targetKind: 'broker',
        callKind: 'async',
        critical: false,
      });
    }
  }
}

function collectObservability(services: ServiceNode[]): {
  logs: LogNode[];
  telemetry: TelemetryNode[];
} {
  const logs: LogNode[] = [];
  const telemetry: TelemetryNode[] = [];

  function walkNodes(nodes: CodeNode[]): void {
    for (const node of nodes) {
      if (node.type === 'log') logs.push(node as LogNode);
      if (node.type === 'telemetry') telemetry.push(node as TelemetryNode);
      walkNodes(node.children);
    }
  }

  for (const service of services) {
    walkNodes(service.endpoints as CodeNode[]);
    walkNodes(service.functions as CodeNode[]);
    walkNodes(service.globals as CodeNode[]);
  }

  return { logs, telemetry };
}

function calculateCoverage(
  services: ServiceNode[],
  telemetry: TelemetryNode[],
): SystemTopology['observability']['coverage'] {
  let endpointsTotal = 0;
  let endpointsWithTracing = 0;
  let dbQueriesTotal = 0;
  let dbQueriesWithSpans = 0;
  let errorsTotal = 0;
  let errorsWithLogging = 0;

  const tracedNodeIds = new Set(
    telemetry.filter(t => t.metadata.kind === 'span').map(t => t.id)
  );

  for (const service of services) {
    endpointsTotal += service.endpoints.length;
    endpointsWithTracing += service.endpoints.filter(e =>
      service.functions.some(f =>
        f.metadata.decorators?.some(d => /span|trace/i.test(d))
      )
    ).length;

    for (const fn of service.functions) {
      const dbNodes = fn.children.filter(c => c.type === 'dbProcess');
      dbQueriesTotal += dbNodes.length;

      const throwNodes = fn.children.filter(c => c.type === 'throw');
      errorsTotal += throwNodes.length;
      errorsWithLogging += fn.children.filter(c => c.type === 'log' &&
        (c as LogNode).metadata.level === 'error').length;
    }
  }

  return {
    endpointsTotal,
    endpointsWithTracing,
    dbQueriesTotal,
    dbQueriesWithSpans,
    errorsTotal,
    errorsWithLogging,
    screensWithAnalytics: 0,
    screensTotal: 0,
  };
}

/**
 * Links orphan ComponentNodes to their parent ScreenNodes based on JSX references.
 * Called after all files are processed — requires context.frontendComponents and
 * context.screenComponentRefs to be populated by the TypeScript parser.
 */
function linkFrontendComponents(context: AnalysisContext): void {
  if (context.frontendComponents.length === 0 || context.screenComponentRefs.size === 0) return;

  // Build index: componentName → ComponentNode
  const byName = new Map<string, import('../types/topology').ComponentNode>();
  for (const comp of context.frontendComponents) {
    if (!byName.has(comp.name)) byName.set(comp.name, comp);
  }

  for (const screen of context.screens) {
    const refs = context.screenComponentRefs.get(screen.id);
    if (!refs) continue;

    // Already-attached component names (the page component itself)
    const attached = new Set(screen.components.map(c => c.name));

    for (const name of refs) {
      if (attached.has(name)) continue;
      const comp = byName.get(name);
      if (comp) {
        screen.components.push(comp);
        attached.add(name);
      }
    }
  }
}

function excludeFrontendExtensions(): string[] {
  return ['.ts', '.java', '.kt', '.py', '.go', '.rs', '.swift', '.cs', '.cpp', '.c'];
}

function collectExternalCallNodes(services: ServiceNode[]): ExternalCallNode[] {
  const results: ExternalCallNode[] = [];
  function walk(nodes: import('../types/topology').CodeNode[]): void {
    for (const n of nodes) {
      if (n.type === 'externalCall') results.push(n as ExternalCallNode);
      walk(n.children);
    }
  }
  for (const svc of services) {
    walk(svc.endpoints as import('../types/topology').CodeNode[]);
    walk(svc.functions as import('../types/topology').CodeNode[]);
  }
  return results;
}
