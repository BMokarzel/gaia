import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import type { EcosystemIndex, ProvisionalFile } from '@topology/core';

const ECOSYSTEM_VERSION = '1.0';
const PROVISIONAL_VERSION = '1.0';

@Injectable()
export class EcosystemService {
  private readonly dataDir: string;
  private readonly ecosystemPath: string;
  private readonly provisionalPath: string;

  constructor(config: ConfigService) {
    const storageDir = config.getOrThrow<string>('STORAGE_DIR');
    // STORAGE_DIR is e.g. ./data/topologies — data dir is one level up
    this.dataDir = resolve(join(storageDir, '..'));
    mkdirSync(this.dataDir, { recursive: true });
    this.ecosystemPath = join(this.dataDir, 'ecosystem.json');
    this.provisionalPath = join(this.dataDir, 'provisional.json');
  }

  getEcosystem(): EcosystemIndex {
    if (!existsSync(this.ecosystemPath)) {
      return this.emptyEcosystem();
    }
    return JSON.parse(readFileSync(this.ecosystemPath, 'utf-8')) as EcosystemIndex;
  }

  saveEcosystem(ecosystem: EcosystemIndex): void {
    ecosystem.updatedAt = new Date().toISOString();
    writeFileSync(this.ecosystemPath, JSON.stringify(ecosystem, null, 2));
  }

  getProvisional(): ProvisionalFile {
    if (!existsSync(this.provisionalPath)) {
      return this.emptyProvisional();
    }
    return JSON.parse(readFileSync(this.provisionalPath, 'utf-8')) as ProvisionalFile;
  }

  saveProvisional(provisional: ProvisionalFile): void {
    provisional.updatedAt = new Date().toISOString();
    writeFileSync(this.provisionalPath, JSON.stringify(provisional, null, 2));
  }

  private emptyEcosystem(): EcosystemIndex {
    return {
      version: ECOSYSTEM_VERSION,
      updatedAt: new Date().toISOString(),
      services: [],
      databases: [],
      edges: [],
    };
  }

  private emptyProvisional(): ProvisionalFile {
    return {
      version: PROVISIONAL_VERSION,
      updatedAt: new Date().toISOString(),
      entries: [],
    };
  }
}
