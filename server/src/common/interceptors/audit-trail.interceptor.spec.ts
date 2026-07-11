import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditAction } from '@pharmaqms/shared';
import { firstValueFrom, of } from 'rxjs';
import { Audited } from '../decorators/audited.decorator';
import { AuditTrailInterceptor } from './audit-trail.interceptor';

class DummyController {
  @Audited({ entityType: 'Document', action: AuditAction.UPDATE })
  auditedMethod(): void {
    /* no-op */
  }

  plainMethod(): void {
    /* no-op */
  }
}

function buildContext(handler: () => void, user: { userId: string; tenantId: string; fullName: string } | undefined) {
  return {
    getHandler: () => handler,
    getClass: () => DummyController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function callHandlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('PLT-2 AuditTrailInterceptor', () => {
  const user = { userId: 'user-1', tenantId: 'tenant-1', fullName: 'QA Head' };

  it('PLT-2: passes the response through unchanged when the handler has no @Audited() metadata', async () => {
    const record = jest.fn();
    const interceptor = new AuditTrailInterceptor(new Reflector(), { record } as never);

    const context = buildContext(DummyController.prototype.plainMethod, user);
    const result = await firstValueFrom(interceptor.intercept(context, callHandlerReturning({ data: { ok: true } })));

    expect(result).toEqual({ data: { ok: true } });
    expect(record).not.toHaveBeenCalled();
  });

  it('PLT-2: records the audit event and strips `audit` from the response', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const interceptor = new AuditTrailInterceptor(new Reflector(), { record } as never);

    const context = buildContext(DummyController.prototype.auditedMethod, user);
    const response = {
      data: { ok: true },
      audit: { entityId: 'doc-1', before: { title: 'Old' }, after: { title: 'New' }, reason: 'Fixed typo' },
    };

    const result = await firstValueFrom(interceptor.intercept(context, callHandlerReturning(response)));

    expect(record).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      actor: { userId: 'user-1', fullName: 'QA Head' },
      entityType: 'Document',
      entityId: 'doc-1',
      action: AuditAction.UPDATE,
      before: { title: 'Old' },
      after: { title: 'New' },
      reason: 'Fixed typo',
    });
    expect(result).toEqual({ data: { ok: true } });
  });

  it('PLT-2: does not record when the handler has @Audited() metadata but the response has no audit payload', async () => {
    const record = jest.fn();
    const interceptor = new AuditTrailInterceptor(new Reflector(), { record } as never);

    const context = buildContext(DummyController.prototype.auditedMethod, user);
    const result = await firstValueFrom(interceptor.intercept(context, callHandlerReturning({ data: { ok: true } })));

    expect(record).not.toHaveBeenCalled();
    expect(result).toEqual({ data: { ok: true } });
  });

  it('PLT-2: does not record when there is no authenticated user on the request', async () => {
    const record = jest.fn();
    const interceptor = new AuditTrailInterceptor(new Reflector(), { record } as never);

    const context = buildContext(DummyController.prototype.auditedMethod, undefined);
    const response = { data: { ok: true }, audit: { entityId: 'doc-1' } };
    const result = await firstValueFrom(interceptor.intercept(context, callHandlerReturning(response)));

    expect(record).not.toHaveBeenCalled();
    expect(result).toEqual(response);
  });
});
