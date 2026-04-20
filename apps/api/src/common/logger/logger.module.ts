import { Module, Global } from '@nestjs/common';
import { resolve } from 'path';
import {
  createLogger, FileTransport, ConsoleTransport, CompositeTransport,
} from '@topology/core';
import { LOGGER_TOKEN } from './logger.token';
import { TopologyLoggerService } from './topology-logger.service';

const loggerProvider = {
  provide: LOGGER_TOKEN,
  useFactory: () => {
    const logDir = resolve(process.cwd(), 'logs');
    const isDev = process.env.NODE_ENV !== 'production';

    const transports = isDev
      ? [
          new CompositeTransport([
            new ConsoleTransport({ level: 'debug', colorize: true }),
            new FileTransport({ dir: logDir, component: 'api' }),
          ]),
        ]
      : [new FileTransport({ dir: logDir, component: 'api' })];

    return createLogger('api', transports, { level: isDev ? 'debug' : 'info' });
  },
};

@Global()
@Module({
  providers: [loggerProvider, TopologyLoggerService],
  exports: [LOGGER_TOKEN, TopologyLoggerService],
})
export class LoggerModule {}
