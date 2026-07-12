import { Injectable } from '@nestjs/common';
import type { DueDateScanner } from './due-date-scanner.interface';

// PLT-6: business modules register their scanners here (typically in their module's
// onModuleInit); DueDateScanService runs everything registered, so the framework needs no
// compile-time knowledge of DOC/TRN/EQP.
@Injectable()
export class DueDateScannerRegistry {
  private readonly scanners = new Map<string, DueDateScanner>();

  register(scanner: DueDateScanner): void {
    if (this.scanners.has(scanner.key)) {
      throw new Error(`A due-date scanner with key "${scanner.key}" is already registered.`);
    }
    this.scanners.set(scanner.key, scanner);
  }

  getAll(): DueDateScanner[] {
    return [...this.scanners.values()];
  }
}
