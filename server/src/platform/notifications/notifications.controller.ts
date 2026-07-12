import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AuditAction, type AuthenticatedUser } from '@pharmaqms/shared';
import { Audited } from '../../common/decorators/audited.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  listNotificationsQuerySchema,
  markNotificationsReadRequestSchema,
  type ListNotificationsQuery,
  type MarkNotificationsReadRequest,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

// PLT-6: a user's own notification log — no @RequirePermission beyond authentication because
// every query is hard-scoped to the caller's own userId; there is no way to address anyone
// else's notifications through this surface.
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
  ) {
    const { items, total } = await this.notificationsService.list(tenantId, user.userId, query);
    return { data: items, meta: { page: query.page, limit: query.limit, total } };
  }

  @Get('unread-count')
  async unreadCount(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    const unread = await this.notificationsService.unreadCount(tenantId, user.userId);
    return { data: { unread } };
  }

  // One audit event per mark-read call (not per notification) — the log entry's content is
  // untouched; only the caller's own read-state changes.
  @Audited({ entityType: 'Notification', action: AuditAction.UPDATE })
  @Post('mark-read')
  async markRead(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(markNotificationsReadRequestSchema)) dto: MarkNotificationsReadRequest,
  ) {
    const target = 'all' in dto ? ({ all: true } as const) : { notificationIds: dto.notificationIds };
    const { before, after, updated } = await this.notificationsService.markRead(tenantId, user.userId, target);
    return {
      data: { updated },
      audit: { entityId: user.userId, before, after },
    };
  }
}
