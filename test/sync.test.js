import assert from 'node:assert/strict';

import { mongodb, test, uri, dbName } from './prepared-mongodb.js';

const ctx = { timeZone: 'UTC', clock: () => Temporal.Instant.from('2026-04-26T12:00:00Z') };

function rawFor(postUri) {
  return {
    uri: postUri,
    slug: postUri.split('/').pop(),
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
    options: {}
  };
}

test('independent connections see committed updates without an adapter index', async () => {
  const cfg = { uri, db: dbName, collection: 'posts' };
  const a = mongodb(cfg);
  const b = mongodb(cfg);

  await a.open(ctx);
  await b.open(ctx);

  try {
    const ins = await a.save(rawFor('2026/04/late'));

    const immediate = await b.find(ins.id);
    assert.equal(immediate.title, 'T');

    await b.sync();

    const updated = await b.save({ ...ins, title: 'changed' });
    assert.equal(updated.id, ins.id);
    assert.equal(updated.title, 'changed');

    const byUri = await b.fetch('2026/04/late');
    assert.equal(byUri.id, ins.id);
  } finally {
    await a.close();
    await b.close();
  }
});
