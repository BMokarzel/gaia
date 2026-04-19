"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectTechStack = detectTechStack;
const fs_1 = require("fs");
const path_1 = require("path");
/**
 * Detecta a stack tecnológica de um serviço a partir do manifesto + código
 */
function detectTechStack(boundary) {
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
function detectNodeStack(rootPath) {
    const pkgPath = (0, path_1.join)(rootPath, 'package.json');
    let pkg = {};
    try {
        pkg = JSON.parse((0, fs_1.readFileSync)(pkgPath, 'utf-8'));
    }
    catch {
        // ignore
    }
    const deps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
        ...(pkg.peerDependencies ?? {}),
    };
    const hasTS = !!deps['typescript'] || !!deps['ts-node'] || (0, fs_1.existsSync)((0, path_1.join)(rootPath, 'tsconfig.json'));
    const framework = detectNodeFramework(deps);
    const databaseHints = detectNodeDatabases(deps);
    const brokerHints = detectNodeBrokers(deps);
    return {
        runtime: 'node',
        language: hasTS ? 'typescript' : 'javascript',
        framework,
        languageVersion: pkg.engines ? pkg.engines.node : undefined,
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
function detectNodeFramework(deps) {
    if (deps['@nestjs/core'])
        return 'nest';
    if (deps['fastify'] || deps['@fastify/core'])
        return 'fastify';
    if (deps['express'])
        return 'express';
    if (deps['koa'])
        return 'koa';
    if (deps['@hapi/hapi'])
        return 'hapi';
    if (deps['next'])
        return 'next';
    if (deps['nuxt'] || deps['nuxt3'])
        return 'nuxt';
    if (deps['@remix-run/node'])
        return 'remix';
    return 'unknown';
}
function detectNodeDatabases(deps) {
    const hints = [];
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
function detectNodeBrokers(deps) {
    const hints = [];
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
function detectJavaStack(rootPath, manifestType) {
    const isKotlin = hasKotlinSources(rootPath);
    const framework = detectJavaFramework(rootPath, manifestType);
    const databaseHints = detectJavaDatabases(rootPath, manifestType);
    const brokerHints = detectJavaBrokers(rootPath, manifestType);
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
        port: 8080,
    };
}
function hasKotlinSources(rootPath) {
    try {
        const { readdirSync, statSync } = require('fs');
        const src = (0, path_1.join)(rootPath, 'src');
        if (!(0, fs_1.existsSync)(src))
            return false;
        function hasKt(dir) {
            try {
                const entries = readdirSync(dir);
                for (const e of entries) {
                    if (e.endsWith('.kt'))
                        return true;
                    const full = (0, path_1.join)(dir, e);
                    if (statSync(full).isDirectory() && hasKt(full))
                        return true;
                }
            }
            catch { }
            return false;
        }
        return hasKt(src);
    }
    catch {
        return false;
    }
}
function detectJavaFramework(rootPath, manifestType) {
    if (manifestType === 'gradle') {
        const content = readFileSafe((0, path_1.join)(rootPath, 'build.gradle'))
            + readFileSafe((0, path_1.join)(rootPath, 'build.gradle.kts'));
        if (content.includes('spring-boot') || content.includes('springframework'))
            return 'spring';
        if (content.includes('quarkus'))
            return 'quarkus';
        if (content.includes('micronaut'))
            return 'micronaut';
        if (content.includes('ktor'))
            return 'ktor';
    }
    else {
        const content = readFileSafe((0, path_1.join)(rootPath, 'pom.xml'));
        if (content.includes('spring-boot') || content.includes('springframework'))
            return 'spring';
        if (content.includes('quarkus'))
            return 'quarkus';
        if (content.includes('micronaut'))
            return 'micronaut';
    }
    return 'spring'; // default para Java
}
function detectJavaDatabases(rootPath, manifestType) {
    const content = manifestType === 'gradle'
        ? readFileSafe((0, path_1.join)(rootPath, 'build.gradle')) + readFileSafe((0, path_1.join)(rootPath, 'build.gradle.kts'))
        : readFileSafe((0, path_1.join)(rootPath, 'pom.xml'));
    const hints = [];
    if (content.includes('spring-data-jpa') || content.includes('hibernate')) {
        hints.push({ alias: 'jpa', engine: 'postgresql', orm: 'jpa' });
    }
    if (content.includes('postgresql'))
        hints.push({ alias: 'postgres', engine: 'postgresql' });
    if (content.includes('mysql'))
        hints.push({ alias: 'mysql', engine: 'mysql' });
    if (content.includes('mongodb'))
        hints.push({ alias: 'mongodb', engine: 'mongodb', orm: 'spring-data-mongodb' });
    if (content.includes('redis'))
        hints.push({ alias: 'redis', engine: 'redis' });
    return hints;
}
function detectJavaBrokers(rootPath, manifestType) {
    const content = manifestType === 'gradle'
        ? readFileSafe((0, path_1.join)(rootPath, 'build.gradle')) + readFileSafe((0, path_1.join)(rootPath, 'build.gradle.kts'))
        : readFileSafe((0, path_1.join)(rootPath, 'pom.xml'));
    const hints = [];
    if (content.includes('kafka'))
        hints.push({ alias: 'kafka', engine: 'kafka' });
    if (content.includes('rabbitmq') || content.includes('amqp'))
        hints.push({ alias: 'rabbitmq', engine: 'rabbitmq' });
    if (content.includes('sqs'))
        hints.push({ alias: 'sqs', engine: 'sqs' });
    return hints;
}
// ---- Python ----
function detectPythonStack(rootPath) {
    const reqs = readFileSafe((0, path_1.join)(rootPath, 'requirements.txt'))
        + readFileSafe((0, path_1.join)(rootPath, 'pyproject.toml'))
        + readFileSafe((0, path_1.join)(rootPath, 'Pipfile'));
    let framework = 'unknown';
    if (reqs.includes('fastapi'))
        framework = 'fastapi';
    else if (reqs.includes('django'))
        framework = 'django';
    else if (reqs.includes('flask'))
        framework = 'flask';
    else if (reqs.includes('litestar'))
        framework = 'litestar';
    const databaseHints = [];
    if (reqs.includes('sqlalchemy') || reqs.includes('SQLAlchemy')) {
        databaseHints.push({ alias: 'sqlalchemy', engine: 'postgresql', orm: 'sqlalchemy' });
    }
    if (reqs.includes('django')) {
        databaseHints.push({ alias: 'django-orm', engine: 'postgresql', orm: 'django' });
    }
    if (reqs.includes('pymongo'))
        databaseHints.push({ alias: 'mongodb', engine: 'mongodb' });
    if (reqs.includes('redis') || reqs.includes('aioredis')) {
        databaseHints.push({ alias: 'redis', engine: 'redis' });
    }
    const brokerHints = [];
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
function detectGoStack(rootPath) {
    const mod = readFileSafe((0, path_1.join)(rootPath, 'go.mod'));
    const sum = readFileSafe((0, path_1.join)(rootPath, 'go.sum'));
    const content = mod + sum;
    let framework = 'unknown';
    if (content.includes('github.com/gin-gonic/gin'))
        framework = 'gin';
    else if (content.includes('github.com/labstack/echo'))
        framework = 'echo';
    else if (content.includes('github.com/gofiber/fiber'))
        framework = 'fiber';
    else if (content.includes('github.com/go-chi/chi'))
        framework = 'chi';
    const databaseHints = [];
    if (content.includes('gorm.io/gorm'))
        databaseHints.push({ alias: 'gorm', engine: 'postgresql', orm: 'gorm' });
    if (content.includes('github.com/lib/pq') || content.includes('jackc/pgx')) {
        databaseHints.push({ alias: 'postgres', engine: 'postgresql' });
    }
    if (content.includes('go.mongodb.org/mongo-driver')) {
        databaseHints.push({ alias: 'mongodb', engine: 'mongodb' });
    }
    if (content.includes('github.com/go-redis/redis')) {
        databaseHints.push({ alias: 'redis', engine: 'redis' });
    }
    const brokerHints = [];
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
function detectRustStack(rootPath) {
    const cargo = readFileSafe((0, path_1.join)(rootPath, 'Cargo.toml'));
    let framework = 'unknown';
    if (cargo.includes('actix-web'))
        framework = 'actix';
    else if (cargo.includes('axum'))
        framework = 'axum';
    else if (cargo.includes('rocket'))
        framework = 'rocket';
    const databaseHints = [];
    if (cargo.includes('sqlx'))
        databaseHints.push({ alias: 'sqlx', engine: 'postgresql', orm: 'sqlx' });
    if (cargo.includes('diesel'))
        databaseHints.push({ alias: 'diesel', engine: 'postgresql', orm: 'diesel' });
    if (cargo.includes('mongodb'))
        databaseHints.push({ alias: 'mongodb', engine: 'mongodb' });
    if (cargo.includes('redis'))
        databaseHints.push({ alias: 'redis', engine: 'redis' });
    const brokerHints = [];
    if (cargo.includes('rdkafka'))
        brokerHints.push({ alias: 'kafka', engine: 'kafka' });
    if (cargo.includes('lapin'))
        brokerHints.push({ alias: 'rabbitmq', engine: 'rabbitmq' });
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
function detectSwiftStack(rootPath) {
    const pkg = readFileSafe((0, path_1.join)(rootPath, 'Package.swift'));
    let framework = 'unknown';
    if (pkg.includes('vapor'))
        framework = 'vapor';
    else if (pkg.includes('perfect'))
        framework = 'perfect';
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
function detectDotnetStack(rootPath) {
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
function inferFromFiles(rootPath) {
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
function readFileSafe(filePath) {
    try {
        return (0, fs_1.readFileSync)(filePath, 'utf-8');
    }
    catch {
        return '';
    }
}
function extractPortFromEnv(rootPath) {
    const envContent = readFileSafe((0, path_1.join)(rootPath, '.env'))
        + readFileSafe((0, path_1.join)(rootPath, '.env.example'))
        + readFileSafe((0, path_1.join)(rootPath, '.env.local'));
    const match = envContent.match(/PORT\s*=\s*(\d+)/);
    return match ? parseInt(match[1], 10) : undefined;
}
function hasGradleDep(rootPath, dep) {
    return readFileSafe((0, path_1.join)(rootPath, 'build.gradle')).includes(dep)
        || readFileSafe((0, path_1.join)(rootPath, 'build.gradle.kts')).includes(dep);
}
function hasMavenDep(rootPath, dep) {
    return readFileSafe((0, path_1.join)(rootPath, 'pom.xml')).includes(dep);
}
//# sourceMappingURL=detector.js.map