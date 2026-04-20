import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { Request, Response } from 'express';
import type { Logger } from '@topology/core';
import { LOGGER_TOKEN } from '../logger/logger.token';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER_TOKEN) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    if (status >= 500) {
      this.logger.error(
        `HTTP ${status} ${req.method} ${req.url}`,
        exception instanceof Error ? exception : undefined,
        { method: req.method, path: req.url, status },
      );
    } else if (status >= 400) {
      this.logger.warn(`HTTP ${status} ${req.method} ${req.url}`, { method: req.method, path: req.url, status });
    }

    res.status(status).json({
      error: { statusCode: status, message, path: req.url, timestamp: new Date().toISOString() },
    });
  }
}
