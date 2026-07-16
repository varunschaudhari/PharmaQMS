// QRX-1 data migration — back-fills the new `Equipment.roomId` reference for records that predate
// the Room master (SPEC.md §7.4, task (e)). For every tenant, groups existing equipment by its
// free-text `location` string, creates one Room per distinct location (via RoomService.create() so
// it gets a real PLT-5 code + PLT-7 QR, exactly like a manually-created room), and back-fills
// `roomId` on all matching equipment. Idempotent: a location whose exact name already has a Room in
// the tenant is reused rather than duplicated; equipment that already has a roomId is left alone.
//
// Usage: `npm run migrate:equipment-rooms -w server`. Requires Mongo running (docker compose up -d).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { RoomClassification } from '@pharmaqms/shared';
import { AppModule } from '../app.module';
import { Equipment, EquipmentDocument } from '../modules/equipment/schemas/equipment.schema';
import { Room, RoomDocument } from '../modules/rooms/schemas/room.schema';
import { RoomService } from '../modules/rooms/room.service';
import { Tenant, TenantDocument } from '../platform/tenant/schemas/tenant.schema';
import type { Model } from 'mongoose';

async function migrate(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const tenantModel = app.get<Model<TenantDocument>>(getModelToken(Tenant.name));
    const equipmentModel = app.get<Model<EquipmentDocument>>(getModelToken(Equipment.name));
    const roomModel = app.get<Model<RoomDocument>>(getModelToken(Room.name));
    const roomService = app.get(RoomService);

    const tenants = await tenantModel.find();
    let totalRoomsCreated = 0;
    let totalEquipmentLinked = 0;
    let tenantsSkipped = 0;

    // Each tenant is migrated independently — one tenant lacking a ROOM numbering scheme (PLT-5;
    // configured per-tenant via the admin numbering-schemes UI, same prerequisite as EQUIPMENT)
    // must not abort the migration for every other tenant.
    for (const tenant of tenants) {
      const tenantId = tenant._id.toString();
      try {
        const unmigrated = await equipmentModel.find({ tenantId, roomId: null });
        if (unmigrated.length === 0) {
          continue;
        }

        const locations = [...new Set(unmigrated.map((e) => e.location.trim()).filter((loc) => loc.length > 0))];
        const roomIdByLocation = new Map<string, string>();

        for (const location of locations) {
          const existingRoom = await roomModel.findOne({ tenantId, name: location });
          if (existingRoom) {
            roomIdByLocation.set(location, existingRoom._id.toString());
            continue;
          }

          // Pre-QRX-1 equipment has no classification concept — default every migrated room to
          // GENERAL; QA can reclassify individual rooms afterward via the desktop UI.
          const room = await roomService.create(tenantId, { name: location, classification: RoomClassification.GENERAL });
          roomIdByLocation.set(location, room.id);
          totalRoomsCreated += 1;
          console.log(`✓ tenant ${tenant.name}: created Room "${location}" (${room.roomCode})`);
        }

        for (const equipment of unmigrated) {
          const location = equipment.location.trim();
          const roomId = roomIdByLocation.get(location);
          if (!roomId) {
            continue; // blank/empty location — nothing to link
          }
          await equipmentModel.updateOne({ _id: equipment._id }, { $set: { roomId } });
          totalEquipmentLinked += 1;
        }
        console.log(`✓ tenant ${tenant.name}: linked ${unmigrated.length} equipment record(s) across ${locations.length} room(s)`);
      } catch (error: unknown) {
        tenantsSkipped += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`⚠ tenant ${tenant.name} (${tenantId}): skipped — ${message}`);
      }
    }

    console.log('');
    console.log(
      `Migration complete: ${totalRoomsCreated} room(s) created, ${totalEquipmentLinked} equipment record(s) linked, ${tenantsSkipped} tenant(s) skipped.`,
    );
  } finally {
    await app.close();
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
