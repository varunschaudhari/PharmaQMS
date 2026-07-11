import { HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import { ErrorCode } from '@pharmaqms/shared';
import type { ZodSchema } from 'zod';
import { AppException } from '../exceptions/app.exception';

// PLT-1 / Iron Rule 7: all input is validated at the edge with zod schemas from packages/shared.
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const message = result.error.issues.map((issue) => issue.message).join('; ');
      throw new AppException(ErrorCode.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST);
    }
    return result.data;
  }
}
