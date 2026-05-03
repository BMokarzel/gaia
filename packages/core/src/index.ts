export { analyzeRepository } from './core/orchestrator';
export type { AnalysisOptions } from './core/orchestrator';

export type { Logger, LogTransport, LogEntry, LogLevel } from './logging/types';
export { NullLogger } from './logging/null-logger';
export { createLogger } from './logging/factory';
export { CoreLogger } from './logging/core-logger';
export { FileTransport } from './logging/transports/file.transport';
export { ConsoleTransport } from './logging/transports/console.transport';
export { CompositeTransport } from './logging/transports/composite.transport';

export { walkRepository, detectServiceBoundaries } from './core/walker';
export type { ServiceBoundary, SourceFile, SupportedLanguage, WalkOptions } from './core/walker';

export { detectTechStack } from './core/detector';
export type { ServiceTechStack, DatabaseHint, BrokerHint } from './core/detector';

export { writeTopology, buildSummary } from './output/writer';
export type { WriteOptions } from './output/writer';

export type * from './types/topology';

export { sanitizeForPrompt, sanitizeArrayForPrompt, escapeRegex } from './utils/prompt-sanitizer';
export { extractHttpClients, normalizeHttpPath } from './extractors/ts/http-client.extractor';
export { enrichService, computeResolvedDependencies } from './analysis/llm-enrichment';
export type { EnrichmentConfig } from './analysis/llm-enrichment';
export { runCrossServiceMerge, applyPendingMerges, writePendingMerges } from './analysis/service-merger';

// Code-graph projection (deep flow trees for endpoints)
export {
  buildServiceFlowGraph,
  findEndpointElement,
  projectEndpointFlow,
} from './projections/topology-projection';

// Documentation generator (Fase 5a)
export {
  buildServiceContext,
  buildEndpointContext,
  formatServicePrompt,
  formatEndpointPrompt,
  generateServiceDoc,
  generateEndpointDoc,
} from './analysis/doc-generator';
export type { DocGenConfig, ServiceDocContext, EndpointDocContext } from './analysis/doc-generator';

// Topology diff (Fase 6 — loop fechado)
export { computeTopologyDiff } from './analysis/topology-diff';
export type {
  TopologyDiff, ServiceModification, EndpointModification,
  EndpointDiffRef, EdgeDiffRef, DiffRef,
} from './analysis/topology-diff';

// PR comment formatter (Fase 7 — PR bot)
export {
  formatPrDiffComment,
  ownersByServiceFromTopology,
} from './analysis/pr-comment-formatter';
export type { PrCommentOptions } from './analysis/pr-comment-formatter';

// Query DSL (Fase 5c)
export { runTopologyQuery } from './analysis/topology-query';
export type {
  TopologyQuery, QueryResult, EndpointHit, DuplicateDbOp,
} from './analysis/topology-query';

// Schema resolver (Fase 8b — deterministic path resolution)
export { resolveSchema, attachEndpointSchemas } from './analysis/schema-resolver';
export type { ResolveSchemaContext } from './analysis/schema-resolver';
export { inferDbReturnShape } from './analysis/db-shape-inferrer';
export { detectFeatureFlag } from './analysis/feature-flag-detector';
export type { FeatureFlagInfo } from './analysis/feature-flag-detector';

// Endpoint simulator (Fase 8)
export { simulateEndpoint } from './analysis/endpoint-simulator';
export type {
  SimulationToggles, SimulationOptions, SimulationResult,
  VisitedThrow, VisitedExternalCall, VisitedDbOp,
  VisitedMiddleware, VisitedReturn, BranchPoint,
} from './analysis/endpoint-simulator';

// Runtime metrics (Fase 4)
export { generateMockRuntimeMetrics } from './analysis/runtime-mock';
export type { MockRuntimeOptions } from './analysis/runtime-mock';
export type {
  RuntimeMetrics, RuntimeWindow, RuntimeSource,
  ServiceMetrics, EndpointMetrics, EdgeMetrics,
  RuntimeAlert, RuntimeAlertKind, RuntimeAlertSeverity,
} from './types/runtime';
