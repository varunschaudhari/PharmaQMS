import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@pharmaqms/shared';

// PLT-1: stable, machine-readable error codes for every thrown HttpException (CLAUDE.md coding conventions).
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ code, message }, status);
  }
}
