import assert from 'node:assert/strict';

import { ObjectId } from 'mongodb';
import { yamb } from 'yamb';

import { mongodb as createStorage, test } from './prepared-mongodb.js';

const conflict = { name: 'PostConflictError', code: 'YAMB_POST_CONFLICT' };
const notFound = { code: 'YAMB_POST_NOT_FOUND' };
const instant = '2026-04-26T12:00:00.000000000Z';
const raw = (slug, overrides = {}) => ({
  uri: `2026/04/${slug}`,
  slug,
  title: slug,
  text: 'Body',
  status: 'published',
  tags: [],
  links: { related: [] },
  options: {},
  createdAt: instant,
  updatedAt: instant,
  publishedAt: instant,
  ...overrides
});

test('save and remove apply only while the stored version matches', async () => {
  const storage = createStorage();
  await storage.open();

  const saved = await storage.save(raw('post', { version: 'v1' }));
  await storage.save({ ...saved, title: 'Second', version: 'v2' }, { expected: 'v1' });

  await assert.rejects(
    storage.save({ ...saved, title: 'Stale', version: 'v3' }, { expected: 'v1' }),
    conflict
  );
  await assert.rejects(storage.remove(saved.id, { expected: 'v1' }), conflict);

  const stored = await storage.find(saved.id);
  assert.equal(stored.title, 'Second');
  assert.equal(stored.version, 'v2');

  await storage.remove(saved.id, { expected: 'v2' });
  assert.equal(await storage.find(saved.id), null);

  const missing = new ObjectId().toString();
  await assert.rejects(storage.save({ ...saved, id: missing }, { expected: 'v2' }), notFound);
  await assert.rejects(storage.remove(missing, { expected: 'v2' }), notFound);
  await assert.rejects(storage.fence(missing, 'v3', { expected: 'v2' }), notFound);
});

test('null expects a record without a version', async () => {
  const storage = createStorage();
  await storage.open();

  const legacy = await storage.save(raw('legacy'));
  const before = await storage.find(legacy.id);
  assert.equal(Object.hasOwn(before, 'version'), false);

  await assert.rejects(storage.fence(legacy.id, 'v1', { expected: 'v0' }), conflict);
  await storage.fence(legacy.id, 'v1', { expected: null });
  await assert.rejects(storage.fence(legacy.id, 'v2', { expected: null }), conflict);

  const after = await storage.find(legacy.id);
  assert.deepEqual(after, { ...before, version: 'v1' });

  await assert.rejects(storage.remove(legacy.id, { expected: null }), conflict);
  await storage.remove(legacy.id, { expected: 'v1' });
});

test('an unconditional write ignores the stored version', async () => {
  const storage = createStorage();
  await storage.open();

  const saved = await storage.save(raw('unconditional', { version: 'v1' }));
  await storage.save({ ...saved, title: 'Forced', version: 'v2' });

  const stored = await storage.find(saved.id);
  assert.equal(stored.title, 'Forced');
  assert.equal(stored.version, 'v2');
});

test('a stale Post conflicts and a fence invalidates a lost write', async () => {
  const blog = yamb({ storage: createStorage() });
  await blog.open();

  try {
    const post = await blog.create({ title: 'Original' });
    const stale = await blog.find(post.id);

    post.title = 'Winner';
    await post.save();

    stale.title = 'Loser';
    await assert.rejects(stale.save(), conflict);

    const previous = post.version;
    await blog.fence(post.id, previous);

    post.title = 'Late';
    await assert.rejects(post.save(), conflict);
    await assert.rejects(post.remove(), conflict);

    const stored = await blog.find(post.id);
    assert.equal(stored.title, 'Winner');
    await stored.remove();
  } finally {
    await blog.close();
  }
});

test('an operator in place of the expected version is rejected', async () => {
  const storage = createStorage();
  await storage.open();

  const saved = await storage.save(raw('operator', { version: 'v1' }));
  const expected = { $ne: null };
  const rejected = { code: 'YAMB_STORAGE_WRITE' };

  await assert.rejects(storage.save({ ...saved, title: 'Forced' }, { expected }), rejected);
  await assert.rejects(storage.fence(saved.id, 'v2', { expected }), rejected);
  await assert.rejects(storage.remove(saved.id, { expected }), rejected);
  assert.deepEqual(await storage.find(saved.id), saved);

  await storage.remove(saved.id);
});
