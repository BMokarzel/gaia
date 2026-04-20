import type { ServiceNode } from '@topology/core';
import type { StoredTopology } from '../../../storage/interfaces/topology-storage.interface';
import type { AnalyzeRequestDto } from '../dto/analyze-request.dto';
import type { UpdateTopologyDto } from '../dto/update-topology.dto';
import type { ListTopologiesDto } from '../dto/list-topologies.dto';
import type { PagedResult } from '../../../common/dto/paged-result.dto';

export interface ITopologyService {
  analyze(dto: AnalyzeRequestDto): Promise<StoredTopology>;
  list(dto: ListTopologiesDto): Promise<PagedResult<StoredTopology>>;
  get(id: string): Promise<StoredTopology>;
  update(id: string, dto: UpdateTopologyDto): Promise<StoredTopology>;
  remove(id: string): Promise<void>;
  getServices(id: string): Promise<ServiceNode[]>;
}
