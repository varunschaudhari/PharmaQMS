import { Module } from '@nestjs/common';
import { FILE_STORAGE } from './file-storage.interface';
import { LocalDiskStorage } from './local-disk-storage';

// DOC-1: object storage seam. Local disk in dev/test; swap this factory for an S3 adapter in
// production (SPEC.md §6 file storage) without touching any consumer.
@Module({
  providers: [
    {
      provide: FILE_STORAGE,
      useFactory: () => new LocalDiskStorage(process.env.FILE_STORAGE_DIR ?? '.data/storage'),
    },
  ],
  exports: [FILE_STORAGE],
})
export class StorageModule {}
