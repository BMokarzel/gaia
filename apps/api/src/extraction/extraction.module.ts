import { Module } from '@nestjs/common';
import { LocalDirectoryAdapter } from './adapters/local-directory.adapter';
import { GitAdapter } from './adapters/git.adapter';
import { ExtractionService } from './extraction.service';
import { EXTRACTION_SERVICE, LOCAL_SOURCE_ADAPTER, GIT_SOURCE_ADAPTER } from './tokens';

@Module({
  providers: [
    LocalDirectoryAdapter,
    GitAdapter,
    { provide: LOCAL_SOURCE_ADAPTER, useClass: LocalDirectoryAdapter },
    { provide: GIT_SOURCE_ADAPTER, useClass: GitAdapter },
    { provide: EXTRACTION_SERVICE, useClass: ExtractionService },
  ],
  exports: [EXTRACTION_SERVICE],
})
export class ExtractionModule {}
