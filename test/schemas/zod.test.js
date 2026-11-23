import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigSchema } from '../../src/schemas/zod.js';

test('ConfigSchema accepts valid config', () => {
  const config = ConfigSchema.parse({
    uri: 'mongodb://127.0.0.1:27017',
    db: 'blog',
    collection: 'posts'
  });

  assert.equal(config.uri, 'mongodb://127.0.0.1:27017');
  assert.equal(config.db, 'blog');
  assert.equal(config.collection, 'posts');
});

test('ConfigSchema requires uri and db', () => {
  assert.throws(() => ConfigSchema.parse({ db: 'blog' }));
  assert.throws(() => ConfigSchema.parse({ uri: 'mongodb://x' }));
});

test('ConfigSchema collection defaults to posts', () => {
  const config = ConfigSchema.parse({ uri: 'mongodb://x', db: 'blog' });
  assert.equal(config.collection, 'posts');
});

test('ConfigSchema rejects unknown keys (strict)', () => {
  assert.throws(() => ConfigSchema.parse({ uri: 'mongodb://x', db: 'blog', extra: 'x' }));
});

test('ConfigSchema rejects index-management options and unofficial clients', () => {
  assert.throws(() => ConfigSchema.parse({ uri: 'mongodb://x', db: 'blog', indexes: false }));
  assert.throws(() => ConfigSchema.parse({ client: { open() {} }, db: 'blog' }));
});
