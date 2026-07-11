import { Types } from 'mongoose';
import { diffObjects } from './audit-diff.util';

describe('PLT-2 diffObjects', () => {
  it('PLT-2: reports no changes for identical objects', () => {
    expect(diffObjects({ title: 'SOP-1' }, { title: 'SOP-1' })).toEqual([]);
  });

  it('PLT-2: reports a changed field with old and new values', () => {
    expect(diffObjects({ title: 'SOP-1' }, { title: 'SOP-2' })).toEqual([
      { field: 'title', oldValue: 'SOP-1', newValue: 'SOP-2' },
    ]);
  });

  it('PLT-2: reports a newly added field when before is missing it', () => {
    expect(diffObjects({}, { title: 'SOP-1' })).toEqual([
      { field: 'title', oldValue: undefined, newValue: 'SOP-1' },
    ]);
  });

  it('PLT-2: reports a removed field when after is missing it', () => {
    expect(diffObjects({ title: 'SOP-1' }, {})).toEqual([
      { field: 'title', oldValue: 'SOP-1', newValue: undefined },
    ]);
  });

  it('PLT-2: treats null and undefined before/after snapshots as empty objects', () => {
    expect(diffObjects(null, { title: 'SOP-1' })).toEqual([
      { field: 'title', oldValue: undefined, newValue: 'SOP-1' },
    ]);
    expect(diffObjects(undefined, undefined)).toEqual([]);
  });

  it('PLT-2: ignores default noise fields (_id, __v, createdAt, updatedAt, passwordHash)', () => {
    const before = { _id: '1', __v: 0, createdAt: new Date(), updatedAt: new Date(), passwordHash: 'old', title: 'A' };
    const after = { _id: '1', __v: 1, createdAt: new Date(), updatedAt: new Date(2030, 0), passwordHash: 'new', title: 'A' };
    expect(diffObjects(before, after)).toEqual([]);
  });

  it('PLT-2: normalizes ObjectId and Date values for stable comparison', () => {
    const id = new Types.ObjectId();
    const date = new Date('2026-01-01T00:00:00.000Z');
    expect(diffObjects({ roleId: id, dueDate: date }, { roleId: id, dueDate: date })).toEqual([]);
  });

  it('PLT-2: reports a changed ObjectId field using its string form', () => {
    const oldId = new Types.ObjectId();
    const newId = new Types.ObjectId();
    expect(diffObjects({ roleId: oldId }, { roleId: newId })).toEqual([
      { field: 'roleId', oldValue: oldId.toString(), newValue: newId.toString() },
    ]);
  });

  it('PLT-2: respects a custom ignoreFields list', () => {
    expect(diffObjects({ secret: 'a', title: 'x' }, { secret: 'b', title: 'x' }, ['secret'])).toEqual([]);
  });
});
