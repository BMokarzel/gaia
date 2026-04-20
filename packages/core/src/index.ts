export { analyzeRepository } from './core/orchestrator';
export type { AnalysisOptions } from './core/orchestrator';

export { walkRepository, detectServiceBoundaries } from './core/walker';
export type { ServiceBoundary, SourceFile, SupportedLanguage, WalkOptions } from './core/walker';

export { detectTechStack } from './core/detector';
export type { ServiceTechStack, DatabaseHint, BrokerHint } from './core/detector';

export { writeTopology, buildSummary } from './output/writer';
export type { WriteOptions } from './output/writer';

export type * from './types/topology';
