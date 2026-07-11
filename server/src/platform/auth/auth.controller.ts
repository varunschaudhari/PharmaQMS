import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuditAction, type AuthenticatedUser } from '@pharmaqms/shared';
import { Audited } from '../../common/decorators/audited.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  refreshRequestSchema,
  type ChangePasswordRequest,
  type LoginRequest,
  type RefreshRequest,
} from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body(new ZodValidationPipe(loginRequestSchema)) dto: LoginRequest) {
    const data = await this.authService.login(dto);
    return { data };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Body(new ZodValidationPipe(refreshRequestSchema)) dto: RefreshRequest) {
    const data = await this.authService.refresh(dto);
    return { data };
  }

  // PLT-1 (added for PLT-2's requirement to audit password changes) — requires a fresh
  // current-password check, not just a valid session.
  @Audited({ entityType: 'User', action: AuditAction.PASSWORD_CHANGED })
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(changePasswordRequestSchema)) dto: ChangePasswordRequest,
  ) {
    const result = await this.authService.changePassword(
      user.userId,
      user.tenantId,
      dto.currentPassword,
      dto.newPassword,
    );
    return { data: { success: true }, audit: result.audit };
  }
}
