import type {
  EndpointNode, FunctionNode, TopologyDiff, RuntimeMetrics,
  SimulationResult, SimulationToggles,
} from '@topology/core';
import type { StoredTopology, SnapshotMeta } from '../../../storage/interfaces/topology-storage.interface';
import type { AnalyzeRequestDto } from '../dto/analyze-request.dto';
import type { UpdateTopologyDto } from '../dto/update-topology.dto';
import type { ListTopologiesDto } from '../dto/list-topologies.dto';
import type { AnalyzeResponseDto } from '../dto/analyze-response.dto';
import type { MergeDecisionDto } from '../dto/merge-decision.dto';
import type { ExportDescribeDto } from '../dto/export-describe.dto';
import type { PagedResult } from '../../../common/dto/paged-result.dto';

export interface EndpointFlowResult {
  serviceId: string;
  service: {
    id: string;
    name: string;
    language?: string;
    framework?: string;
  };
  endpoint: EndpointNode;
  functions: FunctionNode[];
}

export interface SourceSnippet {
  file: string;
  language: string;
  startLine: number;
  endLine: number;
  focusLine: number;
  lines: string[];
}

export interface ExportSections {
  overview?: string;
  flowDescription?: string;
  errorHandling?: string;
  inputs?: string;
  outputs?: string;
  dependencies?: string;
  serviceDescription?: string;
  architectureNotes?: string;
}

export interface ITopologyService {
  analyze(dto: AnalyzeRequestDto): Promise<AnalyzeResponseDto>;
  resolveMergeDecisions(dto: MergeDecisionDto): Promise<AnalyzeResponseDto>;
  list(dto: ListTopologiesDto): Promise<PagedResult<StoredTopology>>;
  get(id: string): Promise<StoredTopology>;
  update(id: string, dto: UpdateTopologyDto): Promise<StoredTopology>;
  remove(id: string): Promise<void>;
  describe(dto: ExportDescribeDto): Promise<{ sections: ExportSections }>;
  getEndpointFlow(topologyId: string, endpointId: string): Promise<EndpointFlowResult>;
  getSourceSnippet(
    topologyId: string,
    relativeFile: string,
    line: number,
    contextLines?: number,
  ): Promise<SourceSnippet>;
  getServiceDoc(topologyId: string, serviceId: string): Promise<{ markdown: string }>;
  getEndpointDoc(topologyId: string, endpointId: string): Promise<{ markdown: string }>;

  reanalyze(topologyId: string): Promise<AnalyzeResponseDto>;
  listSnapshots(topologyId: string): Promise<{ current: SnapshotMeta | null; history: SnapshotMeta[] }>;
  diff(topologyId: string, fromSha: string, toSha: string): Promise<TopologyDiff>;

  /**
   * Returns runtime metrics for a topology (Fase 4). Currently backed by the
   * deterministic mock provider in @topology/core; future revisions will
   * resolve a real provider (Prometheus, OTel) by env config.
   */
  getRuntimeMetrics(
    topologyId: string,
    options?: { windowMs?: number; seed?: number; chaos?: number },
  ): Promise<RuntimeMetrics>;

  /**
   * Walks an endpoint subtree (and its transitively reachable functions),
   * applying optional failure toggles, and returns every observable side
   * effect (throws, externalCalls, dbOps, middlewares, returns) plus the
   * branch points encountered. Pure / no I/O. (Fase 8)
   */
  simulateEndpoint(
    topologyId: string,
    endpointId: string,
    options?: { toggles?: SimulationToggles; maxFunctionDepth?: number },
  ): Promise<SimulationResult>;
}
