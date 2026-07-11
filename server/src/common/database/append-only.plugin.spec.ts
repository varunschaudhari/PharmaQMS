import { MongooseModule, Prop, Schema, SchemaFactory, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { HydratedDocument, Model } from 'mongoose';
import { applyAppendOnly } from './append-only.plugin';

@Schema({ collection: 'appendOnlyPluginFixtures', timestamps: false })
class Fixture {
  @Prop({ type: String, required: true })
  label!: string;
}

type FixtureDocument = HydratedDocument<Fixture>;

const FixtureSchema = SchemaFactory.createForClass(Fixture);
applyAppendOnly(FixtureSchema, 'fixture is append-only: mutation rejected.');

describe('PLT-3 applyAppendOnly (shared by auditEvents and signatures)', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let fixtureModel: Model<FixtureDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([{ name: Fixture.name, schema: FixtureSchema }]),
      ],
    }).compile();
    fixtureModel = moduleRef.get(getModelToken(Fixture.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await fixtureModel.collection.deleteMany({});
  });

  it('PLT-3: create() and find() succeed', async () => {
    await fixtureModel.create({ label: 'a' });
    expect(await fixtureModel.find({})).toHaveLength(1);
  });

  it('PLT-3: updateOne()/updateMany()/findOneAndUpdate() are rejected', async () => {
    await fixtureModel.create({ label: 'a' });
    await expect(fixtureModel.updateOne({ label: 'a' }, { $set: { label: 'b' } })).rejects.toThrow('append-only');
    await expect(fixtureModel.updateMany({ label: 'a' }, { $set: { label: 'b' } })).rejects.toThrow('append-only');
    await expect(fixtureModel.findOneAndUpdate({ label: 'a' }, { $set: { label: 'b' } })).rejects.toThrow(
      'append-only',
    );
  });

  it('PLT-3: deleteOne()/deleteMany()/findOneAndDelete() are rejected', async () => {
    await fixtureModel.create({ label: 'a' });
    await expect(fixtureModel.deleteOne({ label: 'a' })).rejects.toThrow('append-only');
    await expect(fixtureModel.deleteMany({ label: 'a' })).rejects.toThrow('append-only');
    await expect(fixtureModel.findOneAndDelete({ label: 'a' })).rejects.toThrow('append-only');
  });

  it('PLT-3: re-saving an already-persisted document is rejected, but document-level delete/update also reject', async () => {
    const created = await fixtureModel.create({ label: 'a' });
    created.label = 'b';
    await expect(created.save()).rejects.toThrow('append-only');
    await expect(created.deleteOne()).rejects.toThrow('append-only');
    await expect(created.updateOne({ $set: { label: 'c' } })).rejects.toThrow('append-only');
  });
});
