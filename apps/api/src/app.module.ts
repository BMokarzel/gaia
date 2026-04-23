import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { LoggerModule } from './common/logger/logger.module';
import { ExtractionModule } from './extraction/extraction.module';
import { StorageModule } from './storage/storage.module';
import { TopologyModule } from './modules/topology/topology.module';
import { EcosystemModule } from './modules/ecosystem/ecosystem.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule,
    ExtractionModule,
    StorageModule,
    TopologyModule,
    EcosystemModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
export class AppModule {}





