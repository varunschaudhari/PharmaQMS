import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode, type AccessTokenPayload, type AuthenticatedUser } from '@pharmaqms/shared';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppException } from '../exceptions/app.exception';

interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

// PLT-1: verifies the JWT access token and attaches the decoded identity to the request.
// A valid session (cookie/token) is sufficient here — this is authentication, not the
// re-authenticated e-signature challenge that PLT-3 will add on top.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppException(ErrorCode.UNAUTHENTICATED, 'Missing bearer token.', HttpStatus.UNAUTHORIZED);
    }

    const token = authHeader.slice('Bearer '.length);
    try {
      const payload = this.jwtService.verify<AccessTokenPayload>(token, {
        secret: this.configService.get<string>('auth.jwt.accessSecret'),
      });
      if (payload.type !== 'access') {
        throw new Error('Not an access token');
      }
      request.user = {
        userId: payload.sub,
        tenantId: payload.tenantId,
        roleId: payload.roleId,
        email: payload.email,
        fullName: payload.fullName,
        permissions: payload.permissions,
        isPlatformAdmin: payload.isPlatformAdmin,
      };
      return true;
    } catch {
      throw new AppException(ErrorCode.UNAUTHENTICATED, 'Invalid or expired token.', HttpStatus.UNAUTHORIZED);
    }
  }
}
