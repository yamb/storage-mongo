import assert from 'node:assert/strict';
import test from 'node:test';

import { setState } from '../../../src/storage/internal.js';
import find from '../../../src/storage/methods/find.js';

function makeStorage(collection = { findOne: async () => null }) {
  const storage = {};
  setState(storage, { collection });

  return storage;
}

test('find rejects non-string id (NoSQL operator object)', async () => {
  const storage = makeStorage({
    findOne: async () => {
      throw new Error('findOne must not be reached for non-string id');
    }
  });

  await assert.rejects(() => find.fn(storage, { $ne: null }), { code: 'YAMB_STORAGE_READ' });
  await assert.rejects(() => find.fn(storage, null), { code: 'YAMB_STORAGE_READ' });
  await assert.rejects(() => find.fn(storage, undefined), { code: 'YAMB_STORAGE_READ' });
  await assert.rejects(() => find.fn(storage, 42), { code: 'YAMB_STORAGE_READ' });
  await assert.rejects(() => find.fn(storage, []), { code: 'YAMB_STORAGE_READ' });
});

test('find throws StorageNotOpenError when collection is null', async () => {
  const storage = {};
  setState(storage, { collection: null });

  await assert.rejects(() => find.fn(storage, 'any-id'), { code: 'YAMB_STORAGE_NOT_OPEN' });
});
