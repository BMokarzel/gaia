import type { AnalysisContext, SystemTopology, LogNode, TelemetryNode, CodeNode, ServiceNode } from '../types/topology';
import type { ServiceBoundary } from './walker';
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
import { computeCoupling } from '../analysis/coupling';
import { detectUnused } from '../analysis/unused';

export interface AnalysisOptions {
  /** Ignora arquivos de teste */
  skipTests?: boolean;
  /** Inclui análise de frontend */
  includeFrontend?: boolean;
  /** Callback de progresso */
  onProgress?: (message: string) => void;
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
  } = options;

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
  };

  // 1. Detecta boundaries de serviços (monorepo vs single service)
  onProgress('Detecting service boundaries...');
  const boundaries = detectServiceBoundaries(repoPath);
  onProgress(`Found ${boundaries.length} service(s)`);

  // 2. Para cada boundary, analisa os arquivos
  for (const boundary of boundaries) {
    onProgress(`Analyzing service: ${boundary.name}`);
    await analyzeService(boundary, context, { skipTests, includeFrontend, onProgress });
  }

  // 3. Consolida databases e brokers de todos os serviços
  const allDatabases = Array.from(context.databases.values());
  const allBrokers = Array.from(context.brokers.values());

  // 4. Atualiza ServiceDependencies baseado nos databases/brokers encontrados
  for (const service of context.services) {
    enrichServiceDependencies(service, allDatabases, allBrokers);
  }

  // 5. Constrói edges globais
  onProgress('Building edges...');
  const edges = buildEdges(context.services, allDatabases, allBrokers);

  // 5b. Métricas de acoplamento por serviço
  onProgress('Computing coupling metrics...');
  computeCoupling(context.services, edges);

  // 5c. Detecção de código não utilizado
  onProgress('Detecting unused code...');
  detectUnused(context.services, edges, context.diagnostics);

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

  return topology;
}

async function analyzeService(
  boundary: ServiceBoundary,
  context: AnalysisContext,
  options: Required<AnalysisOptions>,
): Promise<void> {
  const { skipTests, includeFrontend, onProgress } = options;

  // Detecta stack tecnológica
  const stack = detectTechStack(boundary);

  // Walk nos arquivos do serviço
  const files = walkRepository(boundary.rootPath, {
    skipTests,
    extensions: includeFrontend ? undefined : excludeFrontendExtensions(),
  });

  onProgress(`  ${files.length} files found in ${boundary.name}`);

  const allCodeNodes: CodeNode[] = [];
  const serviceDatabases: ReturnType<typeof buildDatabaseFromHint>[] = [];
  const serviceBrokers: ReturnType<typeof buildBrokerFromHint>[] = [];

  // Parseia cada arquivo com o parser adequado
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
            }
          }
        }
      }
    } catch (err) {
      context.diagnostics.push({
        level: 'warning',
        message: `Failed to parse ${file.relativePath}: ${(err as Error).message}`,
        location: { file: file.relativePath, line: 1, column: 0 },
      });
    }
  }

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
    const alreadyLinked = service.dependencies.some(d => d.targetId === dbId);
    if (!alreadyLinked) {
      service.dependencies.push({
        targetId: dbId,
        targetType: 'database',
        kind: 'sync',
        critical: true,
      });
    }
  }

  for (const brokerId of brokerIds) {
    const alreadyLinked = service.dependencies.some(d => d.targetId === brokerId);
    if (!alreadyLinked) {
      service.dependencies.push({
        targetId: brokerId,
        targetType: 'broker',
        kind: 'async',
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

function excludeFrontendExtensions(): string[] {
  return ['.ts', '.java', '.kt', '.py', '.go', '.rs', '.swift', '.cs', '.cpp', '.c'];
}
