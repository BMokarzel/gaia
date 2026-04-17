// ============================================================
// System Topology Schema v3
// Do cluster ao pixel — mapeamento completo de sistemas
// ============================================================

// ========================
// LAYER 1 — INFRASTRUCTURE
// (estruturas futuras, não implementadas agora)
// ========================

export interface AccountNode {
id: string;
type: "account";
name: string; // "acme-production"
metadata: {
provider: "aws" | "gcp" | "azure" | "on-premise" | "hybrid";
accountId: string; // "123456789012"
alias?: string; // "prod-main"
rootEmail?: string;
orgUnit?: string; // AWS Organization OU
tags: Record<string, string>;
};
children: RegionNode[];
}

export interface RegionNode {
id: string;
type: "region";
name: string; // "us-east-1"
metadata: {
provider: "aws" | "gcp" | "azure";
displayName: string; // "US East (N. Virginia)"
isPrimary: boolean; // Região principal vs DR
availabilityZones?: string[]; // ["us-east-1a", "us-east-1b"]
};
children: ClusterNode[];
}

export interface ClusterNode {
id: string;
type: "cluster";
name: string; // "prod-eks-main"
metadata: {
kind: "kubernetes" | "ecs" | "lambda" | "vm" | "serverless" | "edge";
orchestrator?: "eks" | "gke" | "aks" | "k3s" | "nomad" | "ecs" | "fargate";
version?: string; // "1.29"
namespace?: string;
nodeCount?: number;
autoscaling?: {
minNodes: number;
maxNodes: number;
policy?: string;
};
tags: Record<string, string>;
};
children: EnvironmentNode[];
}

export interface EnvironmentNode {
id: string;
type: "environment";
name: string; // "production"
metadata: {
kind: "development" | "staging" | "production" | "preview" | "sandbox" | "dr";
url?: string; // "https://api.acme.com"
configSource?: string; // "aws-parameter-store" | "vault" | "env-file"
featureFlags?: string; // "launchdarkly" | "unleash"
promotionFrom?: string; // ID do EnvironmentNode anterior no pipeline
};
/\*_ Serviços deployados neste ambiente _/
services: string[]; // IDs dos ServiceNodes
}

// ========================
// LAYER 2 — SERVICES & RESOURCES
// ========================

export interface ServiceNode {
id: string;
type: "service";
name: string; // "User Service"
metadata: {
/\*_ Identificação _/
code: string; // "user-svc" — identificador principal/sigla
fullName: string; // "User Management Service"
description?: string;
team?: string; // "platform-team"
owner?: string; // "john.doe@acme.com"

    /** Repositório */
    repository: {
      url: string;                     // "https://github.com/acme/user-service"
      branch: string;                  // "main"
      path?: string;                   // "packages/user-svc" (monorepo)
      provider: "github" | "gitlab" | "bitbucket" | "azure-devops" | "codecommit";
    };

    /** Stack técnica */
    runtime: "node" | "deno" | "bun" | "python" | "go" | "java" | "rust" | "dotnet";
    framework?: string;                // "nest" | "express" | "fastify" | "next"
    language: "typescript" | "javascript" | "python" | "go" | "java" | "rust" | "csharp";
    languageVersion?: string;          // "5.4" (TS), "3.12" (Python)

    /** Comunicação */
    protocol: "rest" | "graphql" | "grpc" | "websocket" | "event-driven" | "hybrid";
    basePath?: string;                 // "/api/v2"
    port?: number;

    /** Classificação */
    kind: "backend" | "bff" | "gateway" | "worker" | "cron" | "frontend" | "microfrontend" | "mobile" | "library" | "shared";
    tier?: "critical" | "standard" | "internal";  // Criticidade pro negócio
    domain?: string;                   // "identity" | "payments" | "orders" — bounded context

    /** Observabilidade */
    healthCheck?: string;              // "/health"
    dashboardUrl?: string;             // Link pro Grafana/Datadog
    runbookUrl?: string;               // Runbook de incidentes

};

/\*_ O que esse serviço contém (análise do código) _/
endpoints: EndpointNode[];
functions: FunctionNode[];
globals: DataNode[];

/\*_ Dependências — edges com outros nós do sistema _/
dependencies: ServiceDependency[];
}

export interface ServiceDependency {
targetId: string; // ID do nó destino
targetType: "service" | "database" | "storage" | "broker";
kind: "sync" | "async" | "event" | "scheduled" | "stream";
protocol?: string; // "http" | "grpc" | "amqp" | "kafka" | "s3-api"
description?: string;
critical: boolean; // Se o serviço falha quando essa dep cai
}

// --------------- Database (resource node) ---------------

export interface DatabaseNode {
id: string;
type: "database";
name: string; // "users-postgres"
metadata: {
engine: "postgresql" | "mysql" | "mariadb" | "sqlite"
| "mongodb" | "dynamodb" | "couchdb" | "firestore"
| "neo4j" | "neptune" | "arangodb" // grafo
| "redis" | "memcached" | "valkey" // cache/kv
| "elasticsearch" | "opensearch" | "meilisearch" // search
| "clickhouse" | "bigquery" | "redshift" | "snowflake" // analytics
| "timescaledb" | "influxdb" // time-series
| "custom";
category: "sql" | "nosql" | "graph" | "kv" | "search" | "analytics" | "timeseries";
version?: string; // "16.2"
managed: boolean; // RDS, Atlas, etc vs self-hosted
provider?: string; // "aws-rds" | "supabase" | "planetscale" | "atlas"
host?: string; // "prod-db.cluster-xxx.us-east-1.rds.amazonaws.com"
connectionAlias: string; // Alias referenciado no código — "postgres-main"
replication?: {
strategy: "primary-replica" | "multi-master" | "active-passive";
readReplicas?: number;
};
};
tables: TableNode[];
}

// --------------- Table / Collection ---------------

export interface TableNode {
id: string;
type: "table";
name: string; // "users"
metadata: {
/\*_ Adapta a terminologia por tipo de banco _/
kind: "table" | "collection" | "node_label" | "index" | "keyspace" | "stream" | "bucket";
schema?: string; // "public" (postgres) | "dbo" (sqlserver)
databaseId: string; // Ref ao DatabaseNode pai

    /** Estrutura */
    columns?: ColumnDef[];             // SQL / relacional
    fields?: FieldDef[];               // NoSQL / document
    primaryKey?: string[];
    indexes?: IndexDef[];
    foreignKeys?: ForeignKeyDef[];

    /** Metadados */
    estimatedRows?: number;
    hasTimestamps: boolean;            // created_at, updated_at
    hasSoftDelete: boolean;            // deleted_at
    entityName?: string;               // Nome do model/entity no código: "User"
    migrations?: string[];             // Arquivos de migration relacionados

};
}

export interface ColumnDef {
name: string;
type: string; // "uuid" | "varchar(255)" | "jsonb"
nullable: boolean;
defaultValue?: string;
unique: boolean;
reference?: { // FK inline
tableId: string;
column: string;
};
}

export interface FieldDef {
path: string; // "address.street" (nested)
type: string; // "String" | "Array" | "ObjectId"
required: boolean;
indexed: boolean;
}

export interface IndexDef {
name: string;
columns: string[];
unique: boolean;
type: "btree" | "hash" | "gin" | "gist" | "compound" | "text" | "geospatial";
}

export interface ForeignKeyDef {
columns: string[];
referencesTable: string;
referencesColumns: string[];
onDelete: "cascade" | "set_null" | "restrict" | "no_action";
onUpdate: "cascade" | "set_null" | "restrict" | "no_action";
}

// --------------- Storage ---------------

export interface StorageNode {
id: string;
type: "storage";
name: string; // "user-uploads-bucket"
metadata: {
kind: "object" | "file" | "block" | "archive";
provider: "s3" | "gcs" | "azure-blob" | "minio" | "r2" | "local" | "nfs";
bucket?: string; // "acme-user-uploads-prod"
region?: string;
accessPattern: "public" | "private" | "signed-url" | "cdn";
cdnUrl?: string; // "https://cdn.acme.com/uploads"
lifecycle?: {
retentionDays?: number;
archiveAfterDays?: number;
archiveTier?: string; // "glacier" | "deep-archive"
};
encryption: boolean;
versioning: boolean;
};
}

// --------------- Broker / Message Queue ---------------

export interface BrokerNode {
id: string;
type: "broker";
name: string; // "orders-kafka"
metadata: {
engine: "kafka" | "rabbitmq" | "sqs" | "sns" | "pubsub" | "nats"
| "redis-streams" | "eventbridge" | "kinesis" | "pulsar" | "custom";
category: "queue" | "pubsub" | "stream" | "event-bus";
managed: boolean; // MSK, Amazon SQS, etc
provider?: string; // "aws-msk" | "confluent" | "cloudamqp"
connectionAlias: string;

    /** Tópicos / filas / canais */
    topics: BrokerTopic[];

    /** Config de resiliência */
    deadLetterQueue?: string;          // DLQ associada
    retryPolicy?: {
      maxRetries: number;
      backoffMs: number;
      backoffMultiplier?: number;
    };

};
}

export interface BrokerTopic {
name: string; // "user.created" | "order.payment.processed"
kind: "topic" | "queue" | "exchange" | "channel" | "stream";
producers: string[]; // IDs dos ServiceNodes que publicam
consumers: string[]; // IDs dos ServiceNodes que consomem
schema?: string; // "UserCreatedEvent" — tipo do payload
partitions?: number;
ordering?: "fifo" | "unordered" | "key-based";
}

// ========================
// LAYER 3 — CODE (AST)
// (refinado da v2)
// ========================

export type CodeNodeType =
| "endpoint" | "function" | "call" | "event"
| "dbProcess" | "process" | "flowControl"
| "return" | "throw" | "data"
| "log" | "telemetry";

export interface SourceLocation {
file: string;
line: number;
column: number;
endLine?: number;
endColumn?: number;
}

export interface BaseCodeNode {
id: string;
type: CodeNodeType;
name: string;
location: SourceLocation;
children: CodeNode[];
metadata: Record<string, unknown>;
raw?: string;
}

// -- Endpoint --

export interface EndpointNode extends BaseCodeNode {
type: "endpoint";
metadata: {
method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";
path: string;
framework?: string;
middleware?: string[];
controller?: string;
request: {
params?: TypedField[];
query?: TypedField[];
body?: TypedField[];
bodyType?: string;
headers?: TypedField[];
contentType?: string;
};
responses: EndpointResponse[];
};
}

export interface TypedField {
name: string;
type: string;
required: boolean;
defaultValue?: string;
description?: string;
validation?: string;
}

export interface EndpointResponse {
httpStatus: number;
description?: string;
bodyType?: string;
headers?: TypedField[];
source: "return" | "throw";
nodeId: string;
}

// -- Function --

export interface FunctionNode extends BaseCodeNode {
type: "function";
metadata: {
kind: "declaration" | "expression" | "arrow" | "method" | "constructor" | "getter" | "setter";
async: boolean;
generator: boolean;
params: ParamInfo[];
returnType?: string;
visibility?: "public" | "private" | "protected";
decorators?: string[];
className?: string;
errorMap: ErrorDescriptor[];
};
}

// -- Call --

export interface CallNode extends BaseCodeNode {
type: "call";
metadata: {
callee: string;
arguments: string[];
awaited: boolean;
chained: boolean;
optional: boolean;
resolvedTo?: string;
};
}

// -- Event --

export interface EventNode extends BaseCodeNode {
type: "event";
metadata: {
kind: "emit" | "on" | "once" | "off" | "addEventListener" | "dispatch" | "subscribe" | "publish";
eventName: string;
channel?: string;
payload?: string;
};
}

// -- DB Process --

export interface DbProcessNode extends BaseCodeNode {
type: "dbProcess";
metadata: {
operation: "find" | "findMany" | "findFirst" | "findUnique"
| "create" | "createMany" | "update" | "updateMany" | "upsert"
| "delete" | "deleteMany" | "aggregate" | "groupBy" | "count"
| "raw" | "transaction" | "migrate";
databaseId: string; // Ref ao DatabaseNode
tableId: string; // Ref ao TableNode
orm?: string;
conditions?: string;
fields?: string[];
relations?: string[];
orderBy?: string;
pagination?: { strategy: "offset" | "cursor"; limitField?: string; offsetField?: string };
};
}

// -- Process --

export interface ProcessNode extends BaseCodeNode {
type: "process";
metadata: {
kind: "transformation" | "computation" | "validation" | "assignment"
| "comparison" | "serialization" | "deserialization" | "mapping";
operator?: string;
description?: string;
};
}

// -- Flow Control --

export interface FlowControlNode extends BaseCodeNode {
type: "flowControl";
metadata: {
kind: "if" | "else" | "else_if" | "switch" | "case" | "default"
| "for" | "for_of" | "for_in" | "while" | "do_while"
| "try" | "catch" | "finally"
| "ternary" | "nullish_coalescing" | "optional_chain";
condition?: string;
branches?: { label: string; children: CodeNode[] }[];
};
}

// -- Return --

export interface ReturnNode extends BaseCodeNode {
type: "return";
metadata: {
kind: "explicit" | "implicit" | "response";
value?: string;
valueType?: string;
httpStatus?: number;
responseType?: "json" | "html" | "redirect" | "stream" | "text" | "file";
};
}

// -- Throw --

export interface ThrowNode extends BaseCodeNode {
type: "throw";
metadata: {
kind: "throw" | "reject" | "next_error";
errorClass: string;
message?: string;
httpStatus?: number;
code?: string;
caughtBy?: string;
propagates: boolean;
errorHandler?: string;
};
}

// -- Log --

export interface LogNode extends BaseCodeNode {
type: "log";
metadata: {
level: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "log";
library: "console" | "winston" | "pino" | "bunyan" | "log4js" | "debug" | "custom";
message?: string;
hasStructuredData: boolean;
context?: string[];
includesTraceId: boolean;
includesUserId: boolean;
includesRequestId: boolean;
category: "request" | "response" | "error" | "business_logic" | "performance" | "security" | "lifecycle" | "general";
};
}

// -- Telemetry --

export interface TelemetryNode extends BaseCodeNode {
type: "telemetry";
metadata: {
kind: "span" | "metric" | "trace" | "event" | "baggage" | "context";
span?: {
name: string;
kind: "internal" | "server" | "client" | "producer" | "consumer";
attributes: Record<string, string>;
statusOnError?: string;
};
metric?: {
name: string;
type: "counter" | "histogram" | "gauge" | "updown_counter";
unit?: string;
labels: Record<string, string>;
};
sdk: "otel" | "datadog" | "newrelic" | "honeycomb" | "custom";
instrumentation: "manual" | "auto" | "decorator";
parentSpanRef?: string;
carriesContext: boolean;
};
}

// -- Data --

export interface DataNode extends BaseCodeNode {
type: "data";
metadata: {
kind: "variable" | "constant" | "parameter" | "interface" | "type"
| "enum" | "class" | "object_literal" | "destructuring"
| "import" | "export" | "generic";
dataType?: string;
mutable: boolean;
scope: "local" | "module" | "global" | "class" | "block";
initialValue?: string;
exported?: boolean;
fields?: TypedField[];
};
}

// -- Code node union --

export type CodeNode =
| EndpointNode | FunctionNode | CallNode | EventNode
| DbProcessNode | ProcessNode | FlowControlNode
| ReturnNode | ThrowNode | DataNode
| LogNode | TelemetryNode;

// ========================
// LAYER 4 — FRONTEND
// ========================

export interface ScreenNode {
id: string;
type: "screen";
name: string; // "User Profile"
metadata: {
kind: "page" | "modal" | "drawer" | "sheet" | "dialog" | "tab" | "overlay";
route?: string; // "/users/:id" (rota do router)
routeParams?: TypedField[];
queryParams?: TypedField[];

    /** Contexto do framework */
    framework?: "react" | "vue" | "angular" | "svelte" | "solid" | "react-native" | "flutter" | "swift-ui" | "jetpack-compose";
    filePath: string;                  // "src/pages/UserProfile.tsx"

    /** Auth e acesso */
    authRequired: boolean;
    roles?: string[];                  // ["admin", "manager"]
    guards?: string[];                 // ["AuthGuard", "RoleGuard"]

    /** Layout */
    layout?: string;                   // "DashboardLayout" | "PublicLayout"
    title?: string;                    // Document title / screen title

};
components: ComponentNode[];
/\*_ Navegação — pra quais telas essa tela pode ir _/
navigatesTo: string[]; // IDs de outros ScreenNodes
}

export interface ComponentNode {
id: string;
type: "component";
name: string; // "UserCard"
metadata: {
kind: "page_component" | "layout" | "widget" | "form" | "list" | "table"
| "chart" | "navigation" | "input" | "button" | "modal" | "shared" | "primitive";

    filePath: string;
    exported: boolean;

    /** Props */
    props: TypedField[];

    /** State */
    state: {
      local: TypedField[];             // useState, ref, reactive
      store?: string;                  // "zustand:useUserStore" | "redux:userSlice" | "pinia:useUserStore"
      storeFields?: string[];          // Campos do store que esse component usa
    };

    /** Hooks / lifecycle */
    hooks?: string[];                  // ["useEffect", "useMemo", "useQuery"]
    lifecycle?: string[];              // ["onMounted", "onDestroy"] (Vue/Svelte)

    /** Data fetching */
    queries?: ComponentQuery[];

    /** Renderização condicional */
    conditionalRender?: {
      condition: string;
      showsComponents: string[];       // IDs dos ComponentNodes filhos
    }[];

};
children: ComponentNode[];
events: FrontendEventNode[];
}

export interface ComponentQuery {
hookOrMethod: string; // "useQuery" | "useSWR" | "fetch" | "$http"
key?: string; // "['users', userId]"
endpointId?: string; // Ref ao EndpointNode que essa query chama
method: string; // "GET"
path: string; // "/api/users/:id"
refetchOn?: string[]; // ["focus", "interval:30s", "mutation:updateUser"]
}

export interface FrontendEventNode {
id: string;
type: "frontend_event";
name: string; // "handleSubmit"
metadata: {
trigger: "click" | "submit" | "change" | "hover" | "focus" | "blur"
| "scroll" | "keypress" | "drag" | "swipe" | "longpress"
| "mount" | "unmount" | "intersection" | "timer" | "custom";
element?: string; // "button#save" | "form.user-form"

    /** O que esse evento faz */
    actions: FrontendAction[];

};
location: SourceLocation;
}

export type FrontendAction =
| { kind: "api_call"; endpointId: string; method: string; path: string; body?: string }
| { kind: "navigate"; targetScreenId: string; params?: Record<string, string> }
| { kind: "state_update"; store?: string; field: string; value?: string }
| { kind: "emit_event"; eventName: string; payload?: string }
| { kind: "analytics"; provider: string; eventName: string; properties?: Record<string, string> }
| { kind: "side_effect"; description: string } // toast, modal open, clipboard, etc
| { kind: "validation"; schema?: string; fields?: string[] };

// ========================
// SUPPORTING TYPES
// ========================

export interface ParamInfo {
name: string;
type?: string;
optional: boolean;
defaultValue?: string;
destructured: boolean;
decorators?: string[];
}

export interface ErrorDescriptor {
errorClass: string;
httpStatus?: number;
code?: string;
message?: string;
thrownAt: string;
caughtInternally: boolean;
}

// ========================
// ERROR FLOW MAP
// ========================

export interface ErrorFlowMap {
paths: ErrorPath[];
globalHandlers: {
nodeId: string;
catches: string[];
responseTemplate?: { httpStatus: number; bodyType?: string };
}[];
}

export interface ErrorPath {
origin: { nodeId: string; errorClass: string; context: string };
propagation: {
nodeId: string;
action: "rethrow" | "wrap" | "ignore" | "log_and_rethrow" | "catch_and_handle";
wrapsAs?: string;
}[];
resolution: {
kind: "handled" | "unhandled" | "global_handler";
httpStatus?: number;
responseBody?: string;
handlerNodeId?: string;
};
}

// ========================
// EDGES (grafo global)
// ========================

export type EdgeKind =
// Code-level
| "calls" | "uses" | "emits" | "listens" | "returns"
| "throws" | "catches" | "imports" | "extends" | "logs" | "traces"
// Service-level
| "depends_on" | "publishes_to" | "consumes_from" | "reads_from" | "writes_to"
// Frontend
| "renders" | "navigates_to" | "fetches_from" | "triggers";

export interface Edge {
from: string;
to: string;
kind: EdgeKind;
metadata?: Record<string, unknown>; // Contexto extra: { protocol: "grpc", async: true }
}

// ========================
// TOP-LEVEL OUTPUT
// ========================

export interface SystemTopology {
schemaVersion: "3.0.0";
analyzedAt: string;

// Layer 1 — Infrastructure (futuro)
infrastructure?: {
accounts: AccountNode[];
regions: RegionNode[];
clusters: ClusterNode[];
environments: EnvironmentNode[];
};

// Layer 2 — Services & Resources
services: ServiceNode[];
databases: DatabaseNode[];
storages: StorageNode[];
brokers: BrokerNode[];

// Layer 3 — Code (dentro de cada ServiceNode, mas também acessível flat)
// Acesso via: topology.services[n].endpoints / .functions / .globals

// Layer 4 — Frontend (dentro dos services do tipo frontend/microfrontend/mobile)
screens: ScreenNode[];

// Grafo global de dependências
edges: Edge[];

// Error flow
errorFlow: ErrorFlowMap;

// Observabilidade
observability: {
logs: LogNode[];
telemetry: TelemetryNode[];
coverage: {
endpointsWithTracing: number;
endpointsTotal: number;
dbQueriesWithSpans: number;
dbQueriesTotal: number;
errorsWithLogging: number;
errorsTotal: number;
screensWithAnalytics: number;
screensTotal: number;
};
};

// Diagnósticos da análise
diagnostics: Diagnostic[];
}

export interface Diagnostic {
level: "error" | "warning" | "info";
message: string;
location?: SourceLocation;
rule?: string;
}
