import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ServiceBoundary } from './walker';

export type Runtime = 'node' | 'deno' | 'bun' | 'python' | 'go' | 'java' | 'rust' | 'dotnet';
export type Framework =
  | 'nest' | 'express' | 'fastify' | 'koa' | 'hapi' | 'next' | 'nuxt' | 'remix'
  | 'spring' | 'quarkus' | 'micronaut'
  | 'fastapi' | 'django' | 'flask' | 'litestar'
  | 'ktor' | 'exposed'
  | 'vapor' | 'perfect'
  | 'gin' | 'echo' | 'fiber' | 'chi'
  | 'actix' | 'axum' | 'rocket'
  | 'aspnet'
  | 'unknown';

export type Language =
  | 'typescript' | 'javascript' | 'python' | 'go'
  | 'java' | 'kotlin' | 'swift' | 'rust' | 'csharp';

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
  hasFeign?: boolean;
  javaVersion?: number;
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
export function detectTechStack(boundary: ServiceBoundary): ServiceTechStack {
  switch (boundary.manifestType) {
    case 'npm':
      return detectNodeStack(boundary.rootPath);
    case 'maven':
    case 'gradle':
      return detectJavaStack(boundary.rootPath, boundary.manifestType);
    case 'python':
      return detectPythonStack(boundary.rootPath);
    case 'go':
      return detectGoStack(boundary.rootPath);
    case 'cargo':
      return detectRustStack(boundary.rootPath);
    case 'swift':
      return detectSwiftStack(boundary.rootPath);
    case 'dotnet':
      return detectDotnetStack(boundary.rootPath);
    default:
      return inferFromFiles(boundary.rootPath);
  }
}

// ---- Node.js / TypeScript ----

function detectNodeStack(rootPath: string): ServiceTechStack {
  const pkgPath = join(rootPath, 'package.json');
  let pkg: Record<string, unknown> = {};

  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    // ignore
  }

  const deps = {
    ...((pkg.dependencies as Record<string, string>) ?? {}),
    ...((pkg.devDependencies as Record<string, string>) ?? {}),
    ...((pkg.peerDependencies as Record<string, string>) ?? {}),
  };

  const hasTS = !!deps['typescript'] || !!deps['ts-node'] || existsSync(join(rootPath, 'tsconfig.json'));

  const framework = detectNodeFramework(deps);
  const databaseHints = detectNodeDatabases(deps);
  const brokerHints = detectNodeBrokers(deps);

  return {
    runtime: 'node',
    language: hasTS ? 'typescript' : 'javascript',
    framework,
    languageVersion: pkg.engines ? (pkg.engines as Record<string, string>).node : undefined,
    hasDatabase: databaseHints.length > 0,
    databaseHints,
    hasBroker: brokerHints.length > 0,
    brokerHints,
    hasGraphQL: !!deps['graphql'] || !!deps['@nestjs/graphql'] || !!deps['type-graphql'],
    hasGRPC: !!deps['@grpc/grpc-js'] || !!deps['grpc'],
    port: extractPortFromEnv(rootPath),
    basePath: undefined,
  };
}

function detectNodeFramework(deps: Record<string, string>): Framework {
  if (deps['@nestjs/core']) return 'nest';
  if (deps['fastify'] || deps['@fastify/core']) return 'fastify';
  if (deps['express']) return 'express';
  if (deps['koa']) return 'koa';
  if (deps['@hapi/hapi']) return 'hapi';
  if (deps['next']) return 'next';
  if (deps['nuxt'] || deps['nuxt3']) return 'nuxt';
  if (deps['@remix-run/node']) return 'remix';
  return 'unknown';
}

function detectNodeDatabases(deps: Record<string, string>): DatabaseHint[] {
  const hints: DatabaseHint[] = [];

  if (deps['@prisma/client'] || deps['prisma']) {
    hints.push({ alias: 'prisma', engine: 'postgresql', orm: 'prisma' });
  }
  if (deps['typeorm']) {
    hints.push({ alias: 'typeorm', engine: 'postgresql', orm: 'typeorm' });
  }
  if (deps['sequelize']) {
    hints.push({ alias: 'sequelize', engine: 'postgresql', orm: 'sequelize' });
  }
  if (deps['mongoose'] || deps['@typegoose/typegoose']) {
    hints.push({ alias: 'mongoose', engine: 'mongodb', orm: 'mongoose' });
  }
  if (deps['drizzle-orm']) {
    hints.push({ alias: 'drizzle', engine: 'postgresql', orm: 'drizzle' });
  }
  if (deps['knex']) {
    hints.push({ alias: 'knex', engine: 'postgresql', orm: 'knex' });
  }
  if (deps['ioredis'] || deps['redis']) {
    hints.push({ alias: 'redis', engine: 'redis' });
  }
  if (deps['pg'] || deps['postgres']) {
    hints.push({ alias: 'postgres', engine: 'postgresql' });
  }
  if (deps['mysql'] || deps['mysql2']) {
    hints.push({ alias: 'mysql', engine: 'mysql' });
  }
  if (deps['better-sqlite3'] || deps['sqlite3']) {
    hints.push({ alias: 'sqlite', engine: 'sqlite' });
  }

  return hints;
}

function detectNodeBrokers(deps: Record<string, string>): BrokerHint[] {
  const hints: BrokerHint[] = [];

  if (deps['kafkajs'] || deps['@confluentinc/kafka-javascript']) {
    hints.push({ alias: 'kafka', engine: 'kafka' });
  }
  if (deps['amqplib'] || deps['amqp-connection-manager']) {
    hints.push({ alias: 'rabbitmq', engine: 'rabbitmq' });
  }
  if (deps['@aws-sdk/client-sqs'] || deps['aws-sdk']) {
    hints.push({ alias: 'sqs', engine: 'sqs' });
  }
  if (deps['@aws-sdk/client-sns']) {
    hints.push({ alias: 'sns', engine: 'sns' });
  }
  if (deps['nats']) {
    hints.push({ alias: 'nats', engine: 'nats' });
  }
  if (deps['bullmq'] || deps['bull']) {
    hints.push({ alias: 'bullmq', engine: 'redis-streams' });
  }

  return hints;
}

// ---- Java / Kotlin ----

function detectJavaVersion(rootPath: string, manifestType: 'maven' | 'gradle'): number {
  try {
    if (manifestType === 'gradle') {
      const content = readFileSafe(join(rootPath, 'build.gradle'))
        + readFileSafe(join(rootPath, 'build.gradle.kts'));
      const scMatch = content.match(/sourceCompatibility\s*=\s*['"]?(\d+)['"]?/);
      if (scMatch) return parseInt(scMatch[1], 10);
      const jvMatch = content.match(/JavaVersion\.VERSION_(\d+)/);
      if (jvMatch) return parseInt(jvMatch[1], 10);
    } else {
      const content = readFileSafe(join(rootPath, 'pom.xml'));
      const jvMatch = content.match(/<java\.version>(\d+)<\/java\.version>/);
      if (jvMatch) return parseInt(jvMatch[1], 10);
      const srcMatch = content.match(/<source>(\d+)<\/source>/);
      if (srcMatch) return parseInt(srcMatch[1], 10);
    }
  } catch {}
  return 8;
}

function detectJavaStack(
  rootPath: string,
  manifestType: 'maven' | 'gradle',
): ServiceTechStack {
  const isKotlin = hasKotlinSources(rootPath);
  const framework = detectJavaFramework(rootPath, manifestType);
  const databaseHints = detectJavaDatabases(rootPath, manifestType);
  const brokerHints = detectJavaBrokers(rootPath, manifestType);
  const content = manifestType === 'gradle'
    ? readFileSafe(join(rootPath, 'build.gradle')) + readFileSafe(join(rootPath, 'build.gradle.kts'))
    : readFileSafe(join(rootPath, 'pom.xml'));

  return {
    runtime: 'java',
    language: isKotlin ? 'kotlin' : 'java',
    framework,
    hasDatabase: databaseHints.length > 0,
    databaseHints,
    hasBroker: brokerHints.length > 0,
    brokerHints,
    hasGraphQL: false,
    hasGRPC: hasGradleDep(rootPath, 'grpc') || hasMavenDep(rootPath, 'grpc'),
    hasFeign: content.includes('openfeign'),
    javaVersion: detectJavaVersion(rootPath, manifestType),
    port: 8080,
  };
}

function hasKotlinSources(rootPath: string): boolean {
  try {
    const { readdirSync, statSync } = require('fs');
    const src = join(rootPath, 'src');
    if (!existsSync(src)) return false;

    function hasKt(dir: string): boolean {
      try {
        const entries = readdirSync(dir);
        for (const e of entries) {
          if (e.endsWith('.kt')) return true;
          const full = join(dir, e);
          if (statSync(full).isDirectory() && hasKt(full)) return true;
        }
      } catch {}
      return false;
    }
    return hasKt(src);
  } catch {
    return false;
  }
}

function detectJavaFramework(rootPath: string, manifestType: 'maven' | 'gradle'): Framework {
  if (manifestType === 'gradle') {
    const content = readFileSafe(join(rootPath, 'build.gradle'))
      + readFileSafe(join(rootPath, 'build.gradle.kts'));
    if (content.includes('spring-boot') || content.includes('springframework')) return 'spring';
    if (content.includes('quarkus')) return 'quarkus';
    if (content.includes('micronaut')) return 'micronaut';
    if (content.includes('ktor')) return 'ktor';
  } else {
    const content = readFileSafe(join(rootPath, 'pom.xml'));
    if (content.includes('spring-boot') || content.includes('springframework')) return 'spring';
    if (content.includes('quarkus')) return 'quarkus';
    if (content.includes('micronaut')) return 'micronaut';
  }
  return 'spring'; // default para Java
}

function detectJavaDatabases(rootPath: string, manifestType: 'maven' | 'gradle'): DatabaseHint[] {
  const content = manifestType === 'gradle'
    ? readFileSafe(join(rootPath, 'build.gradle')) + readFileSafe(join(rootPath, 'build.gradle.kts'))
    : readFileSafe(join(rootPath, 'pom.xml'));

  const hints: DatabaseHint[] = [];
  if (content.includes('spring-data-jpa') || content.includes('hibernate')) {
    hints.push({ alias: 'jpa', engine: 'postgresql', orm: 'jpa' });
  }
  if (content.includes('postgresql')) hints.push({ alias: 'postgres', engine: 'postgresql' });
  if (content.includes('mysql')) hints.push({ alias: 'mysql', engine: 'mysql' });
  if (content.includes('mongodb')) hints.push({ alias: 'mongodb', engine: 'mongodb', orm: 'spring-data-mongodb' });
  if (content.includes('redis')) hints.push({ alias: 'redis', engine: 'redis' });
  return hints;
}

function detectJavaBrokers(rootPath: string, manifestType: 'maven' | 'gradle'): BrokerHint[] {
  const content = manifestType === 'gradle'
    ? readFileSafe(join(rootPath, 'build.gradle')) + readFileSafe(join(rootPath, 'build.gradle.kts'))
    : readFileSafe(join(rootPath, 'pom.xml'));

  const hints: BrokerHint[] = [];
  if (content.includes('kafka')) hints.push({ alias: 'kafka', engine: 'kafka' });
  if (content.includes('rabbitmq') || content.includes('amqp')) hints.push({ alias: 'rabbitmq', engine: 'rabbitmq' });
  if (content.includes('sqs')) hints.push({ alias: 'sqs', engine: 'sqs' });
  return hints;
}

// ---- Python ----

function detectPythonStack(rootPath: string): ServiceTechStack {
  const reqs = readFileSafe(join(rootPath, 'requirements.txt'))
    + readFileSafe(join(rootPath, 'pyproject.toml'))
    + readFileSafe(join(rootPath, 'Pipfile'));

  let framework: Framework = 'unknown';
  if (reqs.includes('fastapi')) framework = 'fastapi';
  else if (reqs.includes('django')) framework = 'django';
  else if (reqs.includes('flask')) framework = 'flask';
  else if (reqs.includes('litestar')) framework = 'litestar';

  const databaseHints: DatabaseHint[] = [];
  if (reqs.includes('sqlalchemy') || reqs.includes('SQLAlchemy')) {
    databaseHints.push({ alias: 'sqlalchemy', engine: 'postgresql', orm: 'sqlalchemy' });
  }
  if (reqs.includes('django')) {
    databaseHints.push({ alias: 'django-orm', engine: 'postgresql', orm: 'django' });
  }
  if (reqs.includes('pymongo')) databaseHints.push({ alias: 'mongodb', engine: 'mongodb' });
  if (reqs.includes('redis') || reqs.includes('aioredis')) {
    databaseHints.push({ alias: 'redis', engine: 'redis' });
  }

  const brokerHints: BrokerHint[] = [];
  if (reqs.includes('kafka') || reqs.includes('confluent-kafka')) {
    brokerHints.push({ alias: 'kafka', engine: 'kafka' });
  }
  if (reqs.includes('celery') || reqs.includes('kombu')) {
    brokerHints.push({ alias: 'celery', engine: 'rabbitmq' });
  }

  return {
    runtime: 'python',
    language: 'python',
    framework,
    hasDatabase: databaseHints.length > 0,
    databaseHints,
    hasBroker: brokerHints.length > 0,
    brokerHints,
    hasGraphQL: reqs.includes('strawberry') || reqs.includes('graphene'),
    hasGRPC: reqs.includes('grpcio'),
    port: 8000,
  };
}

// ---- Go ----

function detectGoStack(rootPath: string): ServiceTechStack {
  const mod = readFileSafe(join(rootPath, 'go.mod'));
  const sum = readFileSafe(join(rootPath, 'go.sum'));
  const content = mod + sum;

  let framework: Framework = 'unknown';
  if (content.includes('github.com/gin-gonic/gin')) framework = 'gin';
  else if (content.includes('github.com/labstack/echo')) framework = 'echo';
  else if (content.includes('github.com/gofiber/fiber')) framework = 'fiber';
  else if (content.includes('github.com/go-chi/chi')) framework = 'chi';

  const databaseHints: DatabaseHint[] = [];
  if (content.includes('gorm.io/gorm')) databaseHints.push({ alias: 'gorm', engine: 'postgresql', orm: 'gorm' });
  if (content.includes('github.com/lib/pq') || content.includes('jackc/pgx')) {
    databaseHints.push({ alias: 'postgres', engine: 'postgresql' });
  }
  if (content.includes('go.mongodb.org/mongo-driver')) {
    databaseHints.push({ alias: 'mongodb', engine: 'mongodb' });
  }
  if (content.includes('github.com/go-redis/redis')) {
    databaseHints.push({ alias: 'redis', engine: 'redis' });
  }

  const brokerHints: BrokerHint[] = [];
  if (content.includes('confluent-kafka') || content.includes('segmentio/kafka-go')) {
    brokerHints.push({ alias: 'kafka', engine: 'kafka' });
  }
  if (content.includes('streadway/amqp') || content.includes('rabbitmq')) {
    brokerHints.push({ alias: 'rabbitmq', engine: 'rabbitmq' });
  }

  return {
    runtime: 'go',
    language: 'go',
    framework,
    hasDatabase: databaseHints.length > 0,
    databaseHints,
    hasBroker: brokerHints.length > 0,
    brokerHints,
    hasGraphQL: content.includes('gqlgen') || content.includes('graphql-go'),
    hasGRPC: content.includes('google.golang.org/grpc'),
    port: 8080,
  };
}

// ---- Rust ----

function detectRustStack(rootPath: string): ServiceTechStack {
  const cargo = readFileSafe(join(rootPath, 'Cargo.toml'));

  let framework: Framework = 'unknown';
  if (cargo.includes('actix-web')) framework = 'actix';
  else if (cargo.includes('axum')) framework = 'axum';
  else if (cargo.includes('rocket')) framework = 'rocket';

  const databaseHints: DatabaseHint[] = [];
  if (cargo.includes('sqlx')) databaseHints.push({ alias: 'sqlx', engine: 'postgresql', orm: 'sqlx' });
  if (cargo.includes('diesel')) databaseHints.push({ alias: 'diesel', engine: 'postgresql', orm: 'diesel' });
  if (cargo.includes('mongodb')) databaseHints.push({ alias: 'mongodb', engine: 'mongodb' });
  if (cargo.includes('redis')) databaseHints.push({ alias: 'redis', engine: 'redis' });

  const brokerHints: BrokerHint[] = [];
  if (cargo.includes('rdkafka')) brokerHints.push({ alias: 'kafka', engine: 'kafka' });
  if (cargo.includes('lapin')) brokerHints.push({ alias: 'rabbitmq', engine: 'rabbitmq' });

  return {
    runtime: 'go', // Rust não tem runtime entry no enum, usar custom
    language: 'rust',
    framework,
    hasDatabase: databaseHints.length > 0,
    databaseHints,
    hasBroker: brokerHints.length > 0,
    brokerHints,
    hasGraphQL: cargo.includes('async-graphql') || cargo.includes('juniper'),
    hasGRPC: cargo.includes('tonic'),
    port: 8080,
  };
}

// ---- Swift ----

function detectSwiftStack(rootPath: string): ServiceTechStack {
  const pkg = readFileSafe(join(rootPath, 'Package.swift'));

  let framework: Framework = 'unknown';
  if (pkg.includes('vapor')) framework = 'vapor';
  else if (pkg.includes('perfect')) framework = 'perfect';

  return {
    runtime: 'node',
    language: 'swift',
    framework,
    hasDatabase: pkg.includes('fluent') || pkg.includes('postgres'),
    databaseHints: pkg.includes('fluent')
      ? [{ alias: 'fluent', engine: 'postgresql', orm: 'fluent' }]
      : [],
    hasBroker: false,
    brokerHints: [],
    hasGraphQL: false,
    hasGRPC: false,
    port: 8080,
  };
}

// ---- .NET ----

function detectDotnetStack(rootPath: string): ServiceTechStack {
  return {
    runtime: 'dotnet',
    language: 'csharp',
    framework: 'aspnet',
    hasDatabase: true,
    databaseHints: [{ alias: 'efcore', engine: 'postgresql', orm: 'entity-framework' }],
    hasBroker: false,
    brokerHints: [],
    hasGraphQL: false,
    hasGRPC: false,
    port: 5000,
  };
}

// ---- Fallback ----

function inferFromFiles(rootPath: string): ServiceTechStack {
  return {
    runtime: 'node',
    language: 'typescript',
    framework: 'unknown',
    hasDatabase: false,
    databaseHints: [],
    hasBroker: false,
    brokerHints: [],
    hasGraphQL: false,
    hasGRPC: false,
  };
}

// ---- Helpers ----

function readFileSafe(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function extractPortFromEnv(rootPath: string): number | undefined {
  const envContent = readFileSafe(join(rootPath, '.env'))
    + readFileSafe(join(rootPath, '.env.example'))
    + readFileSafe(join(rootPath, '.env.local'));

  const match = envContent.match(/PORT\s*=\s*(\d+)/);
  return match ? parseInt(match[1], 10) : undefined;
}

function hasGradleDep(rootPath: string, dep: string): boolean {
  return readFileSafe(join(rootPath, 'build.gradle')).includes(dep)
    || readFileSafe(join(rootPath, 'build.gradle.kts')).includes(dep);
}

function hasMavenDep(rootPath: string, dep: string): boolean {
  return readFileSafe(join(rootPath, 'pom.xml')).includes(dep);
}
