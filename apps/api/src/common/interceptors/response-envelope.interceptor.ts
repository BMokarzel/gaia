import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { PagedResult } from '../dto/paged-result.dto';

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value) => {
        if (value instanceof PagedResult) {
          return { data: value.data, meta: value.meta };
        }
        if (value === undefined || value === null) return null;
        return { data: value };
      }),
    );
  }
}
