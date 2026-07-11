import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '@pharmaqms/shared';
import { Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { AuditService } from '../../platform/audit/audit.service';
import { AUDITED_KEY, AuditedOptions, AuditPayload } from '../decorators/audited.decorator';

export interface AuditableResponse {
  audit?: AuditPayload;
  [key: string]: unknown;
}

interface RequestWithUser {
  user?: AuthenticatedUser;
}

// PLT-2: the @Audited() interceptor half of the pattern. Runs on the success path only —
// controllers whose action can also FAIL still audit that failure explicitly (see
// AuthService.login, which predates any authenticated request context to hang an interceptor
// off of in the first place).
@Injectable()
export class AuditTrailInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<AuditedOptions | undefined>(AUDITED_KEY, context.getHandler());
    if (!options) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    return next.handle().pipe(
      mergeMap(async (response: AuditableResponse) => {
        const audit = response?.audit;
        if (!audit || !request.user) {
          return response;
        }

        await this.auditService.record({
          tenantId: request.user.tenantId,
          actor: { userId: request.user.userId, fullName: request.user.fullName },
          entityType: audit.entityType ?? options.entityType,
          entityId: audit.entityId,
          action: audit.action ?? options.action,
          before: audit.before,
          after: audit.after,
          reason: audit.reason,
        });

        const rest: AuditableResponse = { ...response };
        delete rest.audit;
        return rest;
      }),
    );
  }
}
