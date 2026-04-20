import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { ServiceNode } from '@topology/core';
import { EXTRACTION_SERVICE } from '../../extraction/tokens';
import { TOPOLOGY_STORAGE } from '../../storage/tokens';
import type { IExtractionService } from '../../extraction/interfaces/extraction-service.interface';
import type {
  ITopologyStorageRepository,
  StoredTopology,
} from '../../storage/interfaces/topology-storage.interface';
import type { ITopologyService } from './interfaces/topology-service.interface';
import type { AnalyzeRequestDto } from './dto/analyze-request.dto';
import type { UpdateTopologyDto } from './dto/update-topology.dto';
import type { ListTopologiesDto } from './dto/list-topologies.dto';
import { PagedResult } from '../../common/dto/paged-result.dto';
import type { SourceDescriptor } from '../../extraction/interfaces/extraction-source-adapter.interface';

@Injectable()
export class TopologyService implements ITopologyService {
  constructor(
    @Inject(EXTRACTION_SERVICE) private readonly extraction: IExtractionService,
    @Inject(TOPOLOGY_STORAGE) private readonly storage: ITopologyStorageRepository,
  ) {}

  async analyze(dto: AnalyzeRequestDto): Promise<StoredTopology> {
    const source = dto.source as SourceDescriptor;
    const topology = await this.extraction.extract(source, dto.options, dto.clonePolicy);
    const name = dto.name ?? this.deriveName(source);
    return this.storage.save(topology, { name, source, tags: dto.tags });
  }

  async list(dto: ListTopologiesDto): Promise<PagedResult<StoredTopology>> {
    const [items, total] = await this.storage.findAll({
      name: dto.name,
      tags: dto.tags,
      limit: dto.limit,
      offset: dto.offset,
    });
    return new PagedResult(items, total, dto.limit, dto.offset);
  }

  async get(id: string): Promise<StoredTopology> {
    const found = await this.storage.findById(id);
    if (!found) throw new NotFoundException(`Topology ${id} not found`);
    return found;
  }

  async update(id: string, dto: UpdateTopologyDto): Promise<StoredTopology> {
    await this.get(id);
    return this.storage.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    return this.storage.delete(id);
  }

  async getServices(id: string): Promise<ServiceNode[]> {
    return (await this.get(id)).topology.services;
  }

  private deriveName(source: SourceDescriptor): string {
    switch (source.kind) {
      case 'local':  return source.path.split(/[\\/]/).pop() ?? source.path;
      case 'git':    return source.url.split('/').pop()?.replace(/\.git$/, '') ?? source.url;
      case 'github': return `${source.owner}/${source.repo}`;
    }
  }
}
