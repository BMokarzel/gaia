import type { ServiceBoundary } from './walker';
export type Runtime = 'node' | 'deno' | 'bun' | 'python' | 'go' | 'java' | 'rust' | 'dotnet';
export type Framework = 'nest' | 'express' | 'fastify' | 'koa' | 'hapi' | 'next' | 'nuxt' | 'remix' | 'spring' | 'quarkus' | 'micronaut' | 'fastapi' | 'django' | 'flask' | 'litestar' | 'ktor' | 'exposed' | 'vapor' | 'perfect' | 'gin' | 'echo' | 'fiber' | 'chi' | 'actix' | 'axum' | 'rocket' | 'aspnet' | 'unknown';
export type Language = 'typescript' | 'javascript' | 'python' | 'go' | 'java' | 'kotlin' | 'swift' | 'rust' | 'csharp';
export interface ServiceTechStack {
    runtime: Runtime;
    language: Language;
    framework: Framework;
    languageVersion?: string;
    frameworkVersion?: string;
    hasDatabase: boolean;
    databaseHints: DatabaseHint[];
    hasBroker: boolean;
    brokerHints: BrokerHint[];
    hasGraphQL: boolean;
    hasGRPC: boolean;
    port?: number;
    basePath?: string;
}
export interface DatabaseHint {
    alias: string;
    engine: string;
    orm?: string;
}
export interface BrokerHint {
    alias: string;
    engine: string;
}
/**
 * Detecta a stack tecnológica de um serviço a partir do manifesto + código
 */
export declare function detectTechStack(boundary: ServiceBoundary): ServiceTechStack;
//# sourceMappingURL=detector.d.ts.map