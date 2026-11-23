import assert from 'node:assert/strict';

import { MongoClient } from 'mongodb';
import { yamb } from 'yamb';

import { mongodb, test, uri, dbName } from '../../prepared-mongodb.js';

const instant = '2026-04-26T12:00:00.000000000Z';

function raw(slug) {
  return {
    uri: `2026/04/${slug}`,
    slug,
    title: slug,
    text: 'source',
    status: 'published',
    tags: [],
    links: { related: [] },
    options: {},
    createdAt: instant,
    updatedAt: instant,
    publishedAt: instant
  };
}

test('a duplicate insert does not poison a concurrent successful save', async () => {
  const storage = mongodb();
  await storage.open();
  await storage.save(raw('occupied'));

  const [failed, saved] = await Promise.allSettled([
    storage.save(raw('occupied')),
    storage.save(raw('new'))
  ]);

  assert.equal(failed.status, 'rejected');
  assert.equal(failed.reason.code, 'YAMB_STORAGE_DUPLICATE');
  assert.equal(saved.status, 'fulfilled');
  const loaded = await storage.find(saved.value.id);
  assert.equal(loaded.title, 'new');
});

test('stale update after deletion cannot prevent a fresh insert at the same URI', async () => {
  const storage = mongodb();
  await storage.open();
  const old = await storage.save(raw('reusable'));
  await storage.remove(old.id);
  await assert.rejects(() => storage.save({ ...old, title: 'stale' }), {
    code: 'YAMB_POST_NOT_FOUND'
  });

  const fresh = await storage.save(raw('reusable'));
  assert.notEqual(fresh.id, old.id);
  const loaded = await storage.fetch(old.uri);
  assert.equal(loaded.id, fresh.id);
});

test('lost external connection surfaces cursor and save failures without confirming edits', async () => {
  const client = new MongoClient(uri, { retryWrites: false, monitorCommands: true });
  const storage = mongodb({ client, db: dbName });
  const blog = yamb({ storage });

  try {
    await blog.open();
    for (let i = 0; i < 130; i++) {
      await storage.save(raw(`connection-${i}`));
    }
    await blog.sync();
    const post = await blog.fetch('2026/04/connection-0');

    let cursorId;
    client.on('commandSucceeded', (event) => {
      if (event.commandName === 'find' && event.reply.cursor?.id?.toString() !== '0') {
        cursorId = event.reply.cursor.id;
      }
    });

    const iterator = storage.all()[Symbol.asyncIterator]();
    await iterator.next();
    assert.ok(cursorId, 'this scenario needs a live server cursor');

    await client.db(dbName).command({ killCursors: 'posts', cursors: [cursorId] });
    await assert.rejects(() => Array.fromAsync(iterator), { code: 'YAMB_STORAGE_READ' });

    await client.close();
    post.title = 'Unsaved after disconnect';
    await assert.rejects(() => post.save(), { code: 'YAMB_STORAGE_WRITE' });
    assert.equal(post.changes().title, 'Unsaved after disconnect');
  } finally {
    await blog.close();
    await client.close();
  }
});
