import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { ExtractionModule } from './extraction/extraction.module';
import { StorageModule } from './storage/storage.module';
import { TopologyModule } from './modules/topology/topology.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ExtractionModule,
    StorageModule,
    TopologyModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
export class AppModule {}
