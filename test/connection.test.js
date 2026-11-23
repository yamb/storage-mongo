import assert from 'node:assert/strict';
import test from 'node:test';

import { mongodb } from '../src/index.js';

const unreachable = 'mongodb://127.0.0.1:59999/?serverSelectionTimeoutMS=300';

test('open() against an unreachable server throws MongoConnectionError, not MongoIndexError', async () => {
  const storage = mongodb({ uri: unreachable, db: 'yamb_test_53198_2', collection: 'posts' });

  await assert.rejects(() => storage.open(), { code: 'YAMB_MONGODB_CONNECTION' });
});

test('open() with a malformed connection URI throws MongoConnectionError without leaking the URI', async () => {
  const storage = mongodb({ uri: 'not a valid uri', db: 'yamb_test_53198_2', collection: 'posts' });

  await assert.rejects(
    () => storage.open(),
    (err) => {
      assert.equal(err.code, 'YAMB_MONGODB_CONNECTION');
      assert.doesNotMatch(err.message, /not a valid uri/, 'raw uri must not leak into the message');

      return true;
    }
  );
});

test('operations before open reject without reading or writing any record', async () => {
  const storage = mongodb({ uri: unreachable, db: 'yamb_test_53198_2' });
  for (const operation of [
    () => storage.find('507f1f77bcf86cd799439011'),
    () => storage.fetch('2026/04/absent'),
    () => storage.save({ title: 'Unopened' }),
    () => storage.remove('507f1f77bcf86cd799439011'),
    () => storage.sync(),
    () => storage.count({}),
    async () => Array.fromAsync(storage.all({})),
    async () => Array.fromAsync(storage.entries())
  ]) {
    await assert.rejects(operation, { code: 'YAMB_STORAGE_NOT_OPEN' });
  }
});
