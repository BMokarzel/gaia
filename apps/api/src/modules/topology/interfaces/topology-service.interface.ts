import type { StoredTopology } from '../../../storage/interfaces/topology-storage.interface';
import type { AnalyzeRequestDto } from '../dto/analyze-request.dto';
import type { UpdateTopologyDto } from '../dto/update-topology.dto';
import type { ListTopologiesDto } from '../dto/list-topologies.dto';
import type { AnalyzeResponseDto } from '../dto/analyze-response.dto';
import type { MergeDecisionDto } from '../dto/merge-decision.dto';
import type { ExportDescribeDto } from '../dto/export-describe.dto';
import type { PagedResult } from '../../../common/dto/paged-result.dto';

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
}
