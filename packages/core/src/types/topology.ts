// ============================================================
// System Topology Schema v3
// Do cluster ao pixel — mapeamento completo de sistemas
// ============================================================

// ========================
// LAYER 1 — INFRASTRUCTURE (futuro)
// ========================

export interface AccountNode {
  id: string;
  type: "account";
  name: string;
  metadata: {
    provider: "aws" | "gcp" | "azure" | "on-premise" | "hybrid";
    accountId: string;
    alias?: string;
    rootEmail?: string;
    orgUnit?: string;
    tags: Record<string, string>;
  };
  children: RegionNode[];
}

export interface RegionNode {
  id: string;
  type: "region";
  name: string;
  metadata: {
    provider: "aws" | "gcp" | "azure";
    displayName: string;
    isPrimary: boolean;
    availabilityZones?: string[];
  };
  children: ClusterNode[];
}

export interface ClusterNode {
  id: string;
  type: "cluster";
  name: string;
  metadata: {
    kind: "kubernetes" | "ecs" | "lambda" | "vm" | "serverless" | "edge";
    orchestrator?: "eks" | "gke" | "aks" | "k3s" | "nomad" | "ecs" | "fargate";
    version?: string;
    namespace?: string;
    nodeCount?: number;
    autoscaling?: { minNodes: number; maxNodes: number; policy?: string };
    tags: Record<string, string>;
  };
  children: EnvironmentNode[];
}

export interface EnvironmentNode {
  id: string;
  type: "environment";
  name: string;
  metadata: {
    kind: "development" | "staging" | "production" | "preview" | "sandbox" | "dr";
    url?: string;
    configSource?: string;
    featureFlags?: string;
    promotionFrom?: string;
  };
  services: string[];
}

// ========================
// LAYER 2 — SERVICES & RESOURCES
// ========================

export interface ServiceNode {
  id: string;
  type: "service";
  name: string;
  /** Kebab-case identifier derived from the service name, e.g. "user-service" */
  code: string;
  metadata: {
    description?: string;
    team?: string;
    repository?: {
      url?: string;
      branch?: string;
      path?: string;
      provider?: "github" | "gitlab" | "bitbucket" | "azure-devops" | "codecommit";
    };
    runtime?: "node" | "deno" | "bun" | "python" | "go" | "java" | "rust" | "dotnet";
    framework?: string;
    language?: "typescript" | "javascript" | "python" | "go" | "java" | "kotlin" | "swift" | "rust" | "csharp";
    languageVersion?: string;
    protocol?: "rest" | "graphql" | "grpc" | "websocket" | "event-driven" | "hybrid";
    basePath?: string;
    port?: number;
    kind?: "backend" | "bff" | "gateway" | "worker" | "cron" | "frontend" | "microfrontend" | "mobile" | "library" | "shared";
    tier?: "critical" | "standard" | "internal";
    domain?: string;
    healthCheck?: string;
    dashboardUrl?: string;
    runbookUrl?: string;
    llm?: LLMEnrichment;
  };
  endpoints: EndpointNode[];
  functions: FunctionNode[];
  globals: DataNode[];
  /** All outbound dependencies: internal (db/broker/storage/service) and external HTTP. */
  dependencies: Dependency[];
}

export interface Dependency {
  /** Target ID: service/database/storage/broker id, or ExternalCallNode id for external_http */
  id: string;
  /** Display name of the target */
  name?: string;
  /** Nature of the target */
  targetKind: "service" | "database" | "storage" | "broker" | "external_http";
  /** Communication pattern */
  callKind: "sync" | "async" | "event" | "scheduled" | "stream";
  protocol?: string;
  critical: boolean;
  /** Resolution status — set only for external_http dependencies */
  mergeStatus?: "resolved" | "pending_review" | "unresolvable";
  /** EndpointNode ID this resolves to, when mergeStatus === 'resolved' */
  resolvedEndpointId?: string;
  /** Confidence of the cross-service merge match, 0–1 */
  mergeConfidence?: number;
  /** ExternalCallNode IDs that map to this service dependency */
  via?: string[];
}

// --------------- Database ---------------

export interface DatabaseNode {
  id: string;
  type: "database";
  name: string;
  metadata: {
    engine:
      | "postgresql" | "mysql" | "mariadb" | "sqlite"
      | "mongodb" | "dynamodb" | "couchdb" | "firestore"
      | "neo4j" | "neptune" | "arangodb"
      | "redis" | "memcached" | "valkey"
      | "elasticsearch" | "opensearch" | "meilisearch"
      | "clickhouse" | "bigquery" | "redshift" | "snowflake"
      | "timescaledb" | "influxdb"
      | "custom";
    category: "sql" | "nosql" | "graph" | "kv" | "search" | "analytics" | "timeseries";
    version?: string;
    managed?: boolean;
    provider?: string;
    host?: string;
    connectionAlias: string;
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
  name: string;
  metadata: {
    kind: "table" | "collection" | "node_label" | "index" | "keyspace" | "stream" | "bucket";
    schema?: string;
    databaseId: string;
    columns?: ColumnDef[];
    columnNodes?: ColumnNode[];
    fields?: FieldDef[];
    primaryKey?: string[];
    indexes?: IndexDef[];
    foreignKeys?: ForeignKeyDef[];
    estimatedRows?: number;
    hasTimestamps: boolean;
    hasSoftDelete: boolean;
    entityName?: string;
    migrations?: string[];
  };
}

export interface ColumnDef {
  id?: string;
  name: string;
  /** Tipo completo: "uuid" | "varchar(255)" | "jsonb" | "int" | "decimal(10,2)" */
  type: string;
  nullable: boolean;
  defaultValue?: string;
  unique: boolean;
  /** Coluna é chave primária */
  primaryKey: boolean;
  /** Coluna tem autoincrement / serial */
  autoIncrement?: boolean;
  /** Coluna é gerada automaticamente pelo banco */
  generated?: "increment" | "uuid" | "rowid" | "custom";
  /** Tamanho máximo — para varchar, char, binary */
  length?: number;
  /** Precisão total — para decimal/numeric */
  precision?: number;
  /** Casas decimais — para decimal/numeric */
  scale?: number;
  /** Valores permitidos — para enum */
  enumValues?: string[];
  /** Expressão de check constraint */
  check?: string;
  /** Comentário / descrição da coluna */
  comment?: string;
  /** Decorators ORM aplicados nessa coluna */
  decorators?: string[];
  /** Como essa coluna foi descoberta */
  sourceKind: "entity" | "migration" | "schema_file" | "raw_sql" | "orm_method" | "inferred";
  /** Referência de chave estrangeira inline */
  reference?: {
    tableId: string;
    column: string;
  };
  llm?: LLMEnrichment;
}

/** ColumnNode: rich version of ColumnDef used by LLM enrichment */
export interface ColumnNode {
  id: string;
  name: string;
  tableId: string;
  metadata: {
    dataType: string;
    nullable: boolean;
    primaryKey: boolean;
    unique: boolean;
    defaultValue?: string;
    description?: string;
    enumValues?: string[];
    reference?: { tableId: string; column: string };
    llm?: LLMEnrichment;
  };
}

export interface FieldDef {
  path: string;
  type: string;
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
  name: string;
  metadata: {
    kind: "object" | "file" | "block" | "archive";
    provider: "s3" | "gcs" | "azure-blob" | "minio" | "r2" | "local" | "nfs";
    bucket?: string;
    region?: string;
    accessPattern: "public" | "private" | "signed-url" | "cdn";
    cdnUrl?: string;
    lifecycle?: { retentionDays?: number; archiveAfterDays?: number; archiveTier?: string };
    encryption: boolean;
    versioning: boolean;
  };
}

// --------------- Broker / Message Queue ---------------

export interface BrokerNode {
  id: string;
  type: "broker";
  name: string;
  metadata: {
    engine:
      | "kafka" | "rabbitmq" | "sqs" | "sns" | "pubsub" | "nats"
      | "redis-streams" | "eventbridge" | "kinesis" | "pulsar" | "custom";
    category: "queue" | "pubsub" | "stream" | "event-bus";
    managed: boolean;
    provider?: string;
    connectionAlias: string;
    topics: BrokerTopic[];
    deadLetterQueue?: string;
    retryPolicy?: { maxRetries: number; backoffMs: number; backoffMultiplier?: number };
  };
}

export interface BrokerTopic {
  name: string;
  kind: "topic" | "queue" | "exchange" | "channel" | "stream";
  producers: string[];
  consumers: string[];
  schema?: string;
  partitions?: number;
  ordering?: "fifo" | "unordered" | "key-based";
}

// ========================
// LAYER 3 — CODE (AST)
// ========================

export type CodeNodeType =
  | "endpoint" | "function" | "call" | "event"
  | "dbProcess" | "process" | "flowControl"
  | "return" | "throw" | "data"
  | "log" | "telemetry" | "externalCall";

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
    /** FunctionNode.id of the handler that implements this endpoint */
    handlerFnId?: string;
    request: {
      params?: TypedField[];
      query?: TypedField[];
      body?: TypedField[];
      bodyType?: string;
      headers?: TypedField[];
      contentType?: string;
    };
    responses: EndpointResponse[];
    llm?: LLMEnrichment;
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
    complexity?: {
      cyclomatic: number;
      linesOfCode: number;
    };
    sideEffects?: {
      performsIO: boolean;
      throwsUnhandled: boolean;
    };
    inferredReturnShape?: TypedField[];
    llm?: LLMEnrichment;
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
    operation:
      | "find" | "findMany" | "findFirst" | "findUnique"
      | "create" | "createMany" | "update" | "updateMany" | "upsert"
      | "delete" | "deleteMany" | "aggregate" | "groupBy" | "count"
      | "raw" | "transaction" | "migrate";
    databaseId: string;
    tableId: string;
    orm?: string;
    conditions?: string;
    fields?: string[];
    relations?: string[];
    orderBy?: string;
    pagination?: { strategy: "offset" | "cursor"; limitField?: string; offsetField?: string };
    resolvedColumnIds?: string[];
  };
}

// -- Process --

export interface ProcessNode extends BaseCodeNode {
  type: "process";
  metadata: {
    kind:
      | "transformation" | "computation" | "validation" | "assignment"
      | "comparison" | "serialization" | "deserialization" | "mapping";
    operator?: string;
    description?: string;
  };
}

// -- Flow Control --

export interface FlowControlNode extends BaseCodeNode {
  type: "flowControl";
  metadata: {
    kind:
      | "if" | "else" | "else_if" | "switch" | "case" | "default"
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
    kind: "throw" | "reject" | "next_error" | "panic";
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
    kind:
      | "variable" | "constant" | "parameter" | "interface" | "type"
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

// -- External Call --

export interface ExternalCallNode extends BaseCodeNode {
  type: "externalCall";
  metadata: {
    /** HTTP method used */
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";
    /** Extracted path, e.g. /users/:id */
    path: string;
    /** Normalized path for matching: /users/:param */
    pathNormalized?: string;
    /** Base URL if detectable, e.g. https://api.example.com */
    baseUrl?: string;
    /** HTTP client library name (axios, fetch, got, …) */
    httpClient?: string;
    /** Body/query fields observed in the call arguments */
    bodyFields?: string[];
    /** Whether the call is awaited */
    awaited?: boolean;
    /** Merge lifecycle status */
    mergeStatus?: "provisional" | "resolved" | "pending_review" | "unresolvable";
    /** Confidence of merge match, 0–1 */
    mergeConfidence?: number;
    /** Merge reasoning (from LLM or rule) */
    mergeReason?: string;
    /** EndpointNode ID this call resolved to after cross-service merge */
    resolvedEndpointId?: string;
  };
}

// -- Code node union --

export type CodeNode =
  | EndpointNode | FunctionNode | CallNode | EventNode
  | DbProcessNode | ProcessNode | FlowControlNode
  | ReturnNode | ThrowNode | DataNode
  | LogNode | TelemetryNode | ExternalCallNode;

// ========================
// LAYER 4 — FRONTEND
// ========================

export interface ScreenNode {
  id: string;
  type: "screen";
  name: string;
  metadata: {
    kind: "page" | "modal" | "drawer" | "sheet" | "dialog" | "tab" | "overlay";
    route?: string;
    routeParams?: TypedField[];
    queryParams?: TypedField[];
    framework?: "react" | "vue" | "angular" | "svelte" | "solid" | "react-native" | "flutter" | "swift-ui" | "jetpack-compose";
    filePath: string;
    authRequired: boolean;
    roles?: string[];
    guards?: string[];
    layout?: string;
    title?: string;
  };
  components: ComponentNode[];
  navigatesTo: string[];
}

export interface ComponentNode {
  id: string;
  type: "component";
  name: string;
  metadata: {
    kind:
      | "page_component" | "layout" | "widget" | "form" | "list" | "table"
      | "chart" | "navigation" | "input" | "button" | "modal" | "shared" | "primitive";
    filePath: string;
    exported: boolean;
    props: TypedField[];
    state: {
      local: TypedField[];
      store?: string;
      storeFields?: string[];
    };
    hooks?: string[];
    lifecycle?: string[];
    queries?: ComponentQuery[];
    conditionalRender?: { condition: string; showsComponents: string[] }[];
  };
  children: ComponentNode[];
  events: FrontendEventNode[];
}

export interface ComponentQuery {
  hookOrMethod: string;
  key?: string;
  endpointId?: string;
  method: string;
  path: string;
  refetchOn?: string[];
}

export interface FrontendEventNode {
  id: string;
  type: "frontend_event";
  name: string;
  metadata: {
    trigger:
      | "click" | "submit" | "change" | "hover" | "focus" | "blur"
      | "scroll" | "keypress" | "drag" | "swipe" | "longpress"
      | "mount" | "unmount" | "intersection" | "timer" | "custom";
    element?: string;
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
  | { kind: "side_effect"; description: string }
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
  /** Resolved fields when param is a typed object/DTO */
  resolvedFields?: TypedField[];
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
// EDGES
// ========================

export type EdgeKind =
  | "calls" | "uses" | "emits" | "listens" | "returns"
  | "throws" | "catches" | "imports" | "extends" | "logs" | "traces"
  | "depends_on" | "publishes_to" | "consumes_from" | "reads_from" | "writes_to"
  | "renders" | "navigates_to" | "fetches_from" | "triggers" | "resolves_to";

export interface Edge {
  source: string;
  target: string;
  kind: EdgeKind;
  metadata?: Record<string, unknown>;
  /** @deprecated use source */
  from?: string;
  /** @deprecated use target */
  to?: string;
}

// ========================
// TOP-LEVEL OUTPUT
// ========================

export interface SystemTopology {
  schemaVersion: "3.0.0";
  analyzedAt: string;
  infrastructure?: {
    accounts: AccountNode[];
    regions: RegionNode[];
    clusters: ClusterNode[];
    environments: EnvironmentNode[];
  };
  services: ServiceNode[];
  databases: DatabaseNode[];
  storages: StorageNode[];
  brokers: BrokerNode[];
  screens: ScreenNode[];
  edges: Edge[];
  errorFlow: ErrorFlowMap;
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
  diagnostics: Diagnostic[];
}

export interface Diagnostic {
  level: "error" | "warning" | "info";
  message: string;
  location?: SourceLocation;
  rule?: string;
}

// ========================
// ECOSYSTEM INDEX (ecosystem.json)
// ========================

export interface EcosystemIndex {
  version: string;
  updatedAt: string;
  services: EcosystemServiceEntry[];
  databases: EcosystemDatabaseEntry[];
  edges: EcosystemEdge[];
}

export interface EcosystemServiceEntry {
  /** = repoName, e.g. "auth-service" */
  id: string;
  name: string;
  language: string;
  framework: string;
  team?: string;
  repoUrl?: string;
  /** Relative path: "topologies/auth-service.json" */
  topologyFile: string;
  endpointCount: number;
  status: "active" | "provisional";
}

export interface EcosystemDatabaseEntry {
  /** "{repoName}:{databaseName}" */
  id: string;
  name: string;
  kind: string;
  topologyFile: string;
  connectionCount: number;
  status: "active" | "provisional";
}

export interface EcosystemEdge {
  from: string;
  to: string;
}

// ========================
// PROVISIONAL FILE (provisional.json)
// ========================

export interface ProvisionalFile {
  version: string;
  updatedAt: string;
  entries: ProvisionalEntry[];
}

export interface ProvisionalEntry {
  /** nanoid, stable */
  id: string;
  status: "pending" | "resolved";
  resolvedTo?: string;
  resolvedAt?: string;
  provisionalService: {
    name: string;
    status: "provisional";
  };
  provisionalEndpoint: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    params?: string[];
    bodyFields?: string[];
    /** LLM-generated description of what this call does */
    context?: string;
  };
  callerServiceId: string;
  callerServiceName: string;
  callerEndpointId?: string;
  externalCallNodeId: string;
}

// ========================
// LLM ENRICHMENT
// ========================

export interface LLMEnrichment {
  /** Short human-readable name (2–5 words) */
  humanName?: string;
  /** 2–5 sentence description of the node's purpose and flow */
  description?: string;
  summary?: string;
  tags?: string[];
  domain?: string;
  complexity?: "low" | "medium" | "high";
  notes?: string;
  enrichedAt?: string;
  /** Model ID that produced this enrichment */
  enrichedBy?: string;
  model?: string;
}

// ========================
// GRAPH VALIDATION
// ========================

export interface GraphValidationIssue {
  severity: "error" | "warning" | "info";
  description: string;
  suggestion?: string;
  nodeId?: string;
  edgeSource?: string;
  edgeTarget?: string;
  field?: string;
}

export interface GraphValidationResult {
  serviceId: string;
  issues: GraphValidationIssue[];
  /** 0–100 coherence score from LLM */
  coherenceScore: number;
  validatedAt: string;
}

// ========================
// PENDING MERGE (provisional.json)
// ========================

/** A candidate endpoint that may match an external call */
export interface PendingMergeCandidate {
  endpointId: string;
  serviceId: string;
  serviceName: string;
  method: string;
  path: string;
  /** Confidence score 0–1 */
  confidence: number;
}

/** A pending merge entry awaiting user decision */
export interface PendingMergeEntry {
  externalCallId: string;
  context: {
    callerServiceId: string;
    callerServiceName: string;
    method: string;
    path: string;
    bodyFields?: string[];
  };
  candidates: PendingMergeCandidate[];
  llmReason?: string;
  /** Resolved endpointId, 'unresolvable', or null (not yet decided) */
  decision: string | null;
}

/** Root structure of pending-merges.json */
export interface PendingMergesFile {
  generatedAt: string;
  topologyPath: string;
  pendingMerges: PendingMergeEntry[];
}

// ========================
// INTERNAL ANALYSIS CONTEXT
// ========================

/** Contexto acumulado durante a análise de um repositório */
export interface AnalysisContext {
  repoPath: string;
  services: ServiceNode[];
  databases: Map<string, DatabaseNode>;
  brokers: Map<string, BrokerNode>;
  storages: Map<string, StorageNode>;
  screens: ScreenNode[];
  edges: Edge[];
  diagnostics: Diagnostic[];
  /** Índice de nós por ID para resolução de edges */
  nodeIndex: Map<string, BaseCodeNode>;
}
