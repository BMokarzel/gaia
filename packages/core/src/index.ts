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
