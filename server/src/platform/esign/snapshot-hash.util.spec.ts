import { hashEntitySnapshot, verifyEntitySnapshot } from './snapshot-hash.util';

describe('PLT-3 snapshot-hash.util', () => {
  it('PLT-3: produces the same hash regardless of key order', () => {
    const a = hashEntitySnapshot({ title: 'SOP-1', version: 3 });
    const b = hashEntitySnapshot({ version: 3, title: 'SOP-1' });
    expect(a).toBe(b);
  });

  it('PLT-3: produces a different hash when content differs', () => {
    const a = hashEntitySnapshot({ title: 'SOP-1', version: 3 });
    const b = hashEntitySnapshot({ title: 'SOP-1', version: 4 });
    expect(a).not.toBe(b);
  });

  it('PLT-3: produces a 64-character hex SHA-256 digest', () => {
    const hash = hashEntitySnapshot({ title: 'SOP-1' });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('PLT-3: normalizes nested objects and arrays regardless of key order', () => {
    const a = hashEntitySnapshot({ meta: { b: 2, a: 1 }, tags: ['x', 'y'] });
    const b = hashEntitySnapshot({ tags: ['x', 'y'], meta: { a: 1, b: 2 } });
    expect(a).toBe(b);
  });

  it('PLT-3: verifyEntitySnapshot detects a tampered snapshot (hash mismatch)', () => {
    const original = { title: 'SOP-1', version: 3 };
    const hash = hashEntitySnapshot(original);

    expect(verifyEntitySnapshot(original, hash)).toBe(true);
    expect(verifyEntitySnapshot({ title: 'SOP-1', version: 4 }, hash)).toBe(false);
  });
});
