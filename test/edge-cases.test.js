import assert from 'node:assert/strict';

import { getState } from '../src/storage/internal.js';
import { mongodb, test, uri, dbName } from './prepared-mongodb.js';

function rawFor(postUri, overrides = {}) {
  return {
    uri: postUri,
    slug: 'x',
    title: 'T',
    preview: '',
    text: '',
    cover: {},
    tags: [],
    author: { name: 'A' },
    links: { related: [] },
    meta: {},
    social: {},
    status: 'published',
    createdAt: '2026-04-26T10:00:00Z',
    updatedAt: '2026-04-26T10:00:00Z',
    publishedAt: '2026-04-26T12:00:00Z',
    options: {},
    ...overrides
  };
}

async function makeStorage() {
  const storage = mongodb({
    uri,
    db: dbName,
    collection: 'posts'
  });

  await storage.open();

  return storage;
}

async function collect(iterable) {
  const items = [];

  for await (const item of iterable) {
    items.push(item);
  }

  return items;
}

test('uri with regex meta-character is matched exactly, not as regex', async () => {
  const storage = await makeStorage();

  try {
    const r1 = await storage.save(rawFor('2026/04/foo.bar'));
    await storage.save(rawFor('2026/04/fooXbar'));

    const found = await storage.find(r1.id);
    assert.equal(found.uri, '2026/04/foo.bar');

    const all = await collect(storage.all({ uri: '2026/04/foo.bar' }, { order: '-publishedAt' }));
    assert.equal(all.length, 1);
    assert.equal(all[0].uri, '2026/04/foo.bar');
  } finally {
    await storage.close();
  }
});

test('uri starting with $ is treated as a value, not as a Mongo operator', async () => {
  const storage = await makeStorage();

  try {
    const trick = '$where';
    const inserted = await storage.save(rawFor(trick));

    const found = await storage.find(inserted.id);
    assert.equal(found.uri, trick);
    assert.equal(found.title, 'T');
  } finally {
    await storage.close();
  }
});

test('abort signal mid-iteration throws AbortError', async () => {
  const storage = await makeStorage();

  try {
    for (let i = 0; i < 5; i++) {
      await storage.save(rawFor(`2026/04/p${i}`));
    }

    const controller = new AbortController();
    const iterator = storage.all({}, { order: '-publishedAt', signal: controller.signal });

    const seen = [];

    await assert.rejects(
      async () => {
        for await (const doc of iterator) {
          seen.push(doc);

          if (seen.length === 1) {
            controller.abort();
          }
        }
      },
      (err) => err?.name === 'AbortError'
    );

    assert.equal(seen.length, 1);
  } finally {
    await storage.close();
  }
});

test('empty collection yields empty iterator', async () => {
  const storage = await makeStorage();

  try {
    const items = await collect(storage.all({}, { order: '-publishedAt' }));
    assert.deepEqual(items, []);
  } finally {
    await storage.close();
  }
});

test('id-based links.related survive rename without storage rewrite', async () => {
  const storage = await makeStorage();

  try {
    const target = await storage.save(rawFor('2026/04/target'));
    const targetId = target.id;

    const referrerCount = 5;
    const referrerIds = [];

    for (let i = 0; i < referrerCount; i++) {
      const ref = await storage.save(
        rawFor(`2026/04/ref-${i}`, { links: { related: [targetId] } })
      );

      referrerIds.push(ref.id);
    }

    await storage.save({ ...rawFor('2026/04/renamed'), id: targetId });

    for (const refId of referrerIds) {
      const r = await storage.find(refId);
      assert.deepEqual(r.links.related, [targetId]);
    }

    const renamed = await storage.find(targetId);
    assert.equal(renamed.uri, '2026/04/renamed');
  } finally {
    await storage.close();
  }
});

test('reopen after close reads persisted documents', async () => {
  const storage = mongodb({
    uri,
    db: dbName,
    collection: 'posts'
  });

  await storage.open();
  const inserted = await storage.save(rawFor('2026/04/persist'));
  const persistId = inserted.id;
  await storage.close();

  await storage.open();

  try {
    const found = await storage.find(persistId);
    assert.equal(found.uri, '2026/04/persist');

    await assert.rejects(
      () => storage.save(rawFor('2026/04/persist')),
      (err) => err.code === 'YAMB_STORAGE_DUPLICATE'
    );
  } finally {
    await storage.close();
  }
});

test('close() with an already-aborted signal still releases its client', async () => {
  const storage = mongodb({
    uri,
    db: dbName,
    collection: 'posts'
  });

  await storage.open();

  const controller = new AbortController();
  controller.abort();

  await storage.close({ signal: controller.signal });

  const state = getState(storage);
  assert.equal(state.client, null, 'the client must be closed and nulled, not leaked');
});

test('tag with special characters is matched exactly', async () => {
  const storage = await makeStorage();

  try {
    const oddTag = 'c++';
    const r1 = await storage.save(rawFor('2026/04/a', { tags: [oddTag] }));
    await storage.save(rawFor('2026/04/b', { tags: ['c'] }));

    const found = await collect(storage.all({ tag: oddTag }, { order: '-publishedAt' }));
    assert.equal(found.length, 1);
    assert.equal(found[0].id, r1.id);
  } finally {
    await storage.close();
  }
});
