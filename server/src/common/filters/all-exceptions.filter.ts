import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ErrorCode } from '@pharmaqms/shared';
import type { Response } from 'express';

interface ErrorResponseBody {
  code: string;
  message: string;
}

// Global exception filter — shapes every error response as { error: { code, message } }
// and never leaks stack traces for unhandled errors (CLAUDE.md Iron Rules / coding conventions).
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({ error: this.normalize(exception.getResponse(), status) });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ error: { code: ErrorCode.INTERNAL_ERROR, message: 'Internal server error' } });
  }

  private normalize(body: unknown, status: number): ErrorResponseBody {
    if (typeof body === 'object' && body !== null && 'code' in body && 'message' in body) {
      const { code, message } = body as { code: unknown; message: unknown };
      return { code: String(code), message: String(message) };
    }
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : 'Request failed';
    return { code: this.codeForStatus(status), message };
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHENTICATED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.PERMISSION_DENIED;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      default:
        return ErrorCode.INTERNAL_ERROR;
    }
  }
}
