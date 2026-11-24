import assert from 'node:assert/strict';

import { Decimal128, Double, Long, MongoClient, ObjectId } from 'mongodb';
import { yamb } from 'yamb';
import { z } from 'zod';

import { mongodb } from '../src/index.js';
import { buildMongoFilter } from '../src/query/filter.js';
import { buildMongoSort } from '../src/query/sort.js';
import { test } from './prepared-mongodb.js';

const uri = process.env.MONGO_URI;
const dbName = process.env.YAMB_MONGO_DB;
const instant = '2026-11-01T12:00:00.000000000Z';
const cases = [
  { status: 'published', publishedAt: instant },
  { status: 'draft', homepage: false },
  { status: 'scheduled', publishedAt: instant, homepage: true },
  { status: 'archived', homepage: null }
];

function stages(node, name, found = []) {
  if (node?.stage === name) {
    found.push(node);
  }

  for (const child of Object.values(node ?? {})) {
    if (typeof child === 'object') {
      stages(child, name, found);
    }
  }

  return found;
}

test('MongoDB selection, default filters, pagination and cache survive save/reload on prepared structure', async () => {
  assert.ok(uri && dbName, 'MONGO_URI and YAMB_MONGO_DB must name the prepared database');
  const client = new MongoClient(uri, { retryWrites: false, monitorCommands: true });
  await client.connect();
  const coll = client.db(dbName).collection('posts');
  assert.equal(await coll.countDocuments({}), 0);
  const storage = mongodb({ client, db: dbName });
  const blog = yamb({
    storage,
    options: z
      .strictObject({
        homepage: z.boolean().nullable().default(false),
        kind: z.string(),
        score: z.number().optional()
      })
      .refine((value) => value.kind === 'article'),
    clock: () => Temporal.Instant.from(instant)
  });
  const ids = [];
  await blog.open();

  try {
    for (let i = 0; i < 12; i++) {
      const { status, publishedAt, homepage } = cases[i % cases.length];
      const slug = `article-${String(i).padStart(2, '0')}`;
      const directory = publishedAt === undefined ? 'drafts' : '2026/11';
      const options = { kind: 'article', score: i % 2 };

      if (homepage !== undefined) {
        options.homepage = homepage;
      }

      const post = {
        uri: `${directory}/${slug}`,
        slug,
        title: `Article ${i}`,
        text: '**selection**',
        status,
        createdAt: instant,
        updatedAt: instant,
        tags: ['article'],
        meta: { description: 'Original description' },
        links: { related: [] },
        options
      };

      if (publishedAt !== undefined) {
        post.publishedAt = publishedAt;
      }

      const raw = await storage.save(post);
      ids.push(raw.id);
    }

    await blog.sync();

    const all = await blog.all().toArray();
    assert.equal(all.length, 12);
    assert.deepEqual(
      all.map((p) => p.title),
      [
        'Article 10',
        'Article 8',
        'Article 6',
        'Article 4',
        'Article 2',
        'Article 0',
        'Article 11',
        'Article 9',
        'Article 7',
        'Article 5',
        'Article 3',
        'Article 1'
      ]
    );

    const ascending = await blog.all({}, { order: 'publishedAt' }).toArray();
    assert.deepEqual(
      ascending.map((p) => p.title),
      [
        'Article 1',
        'Article 3',
        'Article 5',
        'Article 7',
        'Article 9',
        'Article 11',
        'Article 0',
        'Article 2',
        'Article 4',
        'Article 6',
        'Article 8',
        'Article 10'
      ]
    );

    const published = await blog.published.toArray();
    assert.equal(published.length, 3);

    const withoutHomepage = blog.all({ options: { homepage: false } });
    const falsePosts = await withoutHomepage.toArray();
    assert.equal(falsePosts.length, 6);
    assert.ok(falsePosts.every((p) => p.options.homepage === false));
    assert.equal(await withoutHomepage.limit(0).offset(99).count(), 6);
    assert.equal(await withoutHomepage.limit(0).first(), null);
    assert.equal(await blog.all({ options: { homepage: true } }).count(), 3);
    assert.equal(await blog.all({ options: { homepage: null } }).count(), 3);
    assert.equal(await blog.all({ options: { homepage: false, score: 0 } }).count(), 3);
    assert.equal(await blog.all({ options: { kind: 'other' } }).count(), 0);
    assert.equal(await blog.all({ options: { kind: '$options.kind' } }).count(), 0);
    const page = await withoutHomepage.offset(1).limit(2).toArray();
    const first = await withoutHomepage.offset(1).first();
    assert.equal(first.id, page[0].id);

    const firstIterator = blog.all()[Symbol.asyncIterator]();
    const secondIterator = blog.all()[Symbol.asyncIterator]();
    const firstStep = await firstIterator.next();
    const secondStep = await secondIterator.next();
    assert.equal(firstStep.value.id, secondStep.value.id);
    await firstIterator.return();
    await secondIterator.return();

    const post = await blog.find(ids[0]);
    const cache = new Map([[post.hash(), post.toJSON()]]);
    await post.save();
    const reloaded = await blog.find(post.id);
    assert.deepEqual(cache.get(reloaded.hash()), reloaded.toJSON());

    reloaded.options.homepage = true;
    assert.equal(cache.has(reloaded.hash()), false);
    reloaded.meta.description = 'Edited description';
    reloaded.text = '**Source**';
    await reloaded.save();
    const after = await blog.find(post.id);
    assert.equal(after.options.homepage, true);
    assert.equal(after.meta.description, 'Edited description');
    assert.equal(after.text, '**Source**');
    assert.equal(after.hash(), reloaded.hash());
    assert.equal(await withoutHomepage.count(), 5);
    assert.equal(await blog.all({ options: { homepage: true } }).count(), 4);

    for (const options of [{ 'a.b': false }, { $where: true }, { homepage: { $ne: null } }]) {
      await assert.rejects(async () => Array.fromAsync(storage.all({ options })), {
        code: 'YAMB_QUERY_VALIDATION'
      });
      await assert.rejects(() => storage.count({ options }), { code: 'YAMB_QUERY_VALIDATION' });
    }

    const removed = await blog.find(ids[1]);
    await coll.deleteOne({ _id: new ObjectId(removed.id) });
    removed.title = 'Must stay deleted';
    await assert.rejects(() => removed.save(), { code: 'YAMB_POST_NOT_FOUND' });
    assert.equal(await storage.find(removed.id), null);
    ids.splice(ids.indexOf(removed.id), 1);
  } finally {
    for (const id of ids) {
      await storage.remove(id);
    }
    await blog.close();
    assert.equal(await coll.countDocuments({}), 0);
    await client.close();
  }
});

test('MongoDB server cursors close on break, callback failure, take, return, dispose and native abort', async () => {
  assert.ok(uri && dbName);
  const client = new MongoClient(uri, { retryWrites: false, monitorCommands: true });
  await client.connect();
  const coll = client.db(dbName).collection('posts');
  assert.equal(await coll.countDocuments({}), 0);
  const storage = mongodb({ client, db: dbName });
  const blog = yamb({ storage });
  const ids = [];
  const live = new Set();
  const opened = [];
  const observe = (event) => {
    const { cursor } = event.reply;

    if (
      event.commandName === 'find' &&
      cursor?.ns === `${dbName}.posts` &&
      cursor.id.toString() !== '0'
    ) {
      live.add(cursor.id.toString());
      opened.push(cursor.id.toString());
    }

    if (event.commandName === 'killCursors') {
      for (const id of event.reply.cursorsKilled ?? []) {
        live.delete(id.toString());
      }
    }
  };
  await blog.open();

  try {
    for (let i = 0; i < 130; i++) {
      const p = await blog.create({ title: `Cursor ${i}`, text: 'cursor' });
      ids.push(p.id);
    }

    client.on('commandSucceeded', observe);

    for await (const p of blog.all()) {
      assert.ok(p.id);
      break;
    }
    assert.equal(live.size, 0);

    const error = new Error('callback');
    await assert.rejects(
      () =>
        blog
          .all()
          .filter(() => {
            throw error;
          })
          .toArray(),
      (e) => e === error
    );
    assert.equal(live.size, 0);

    const taken = await blog.all().take(1).toArray();
    assert.equal(taken.length, 1);
    assert.equal(live.size, 0);

    const manual = blog.all().map((p) => p.title);
    await manual.next();
    await manual.return();
    assert.equal(live.size, 0);

    const disposed = blog.all().map((p) => p.title);
    await disposed.next();
    await disposed[Symbol.asyncDispose]();
    assert.equal(live.size, 0);

    const controller = new AbortController();
    const reason = { stop: 'selection' };
    const iterator = blog.all({}, { signal: controller.signal })[Symbol.asyncIterator]();
    await iterator.next();
    controller.abort(reason);
    await assert.rejects(
      () => iterator.next(),
      (e) => e === reason
    );
    assert.equal(live.size, 0);
    const exhausted = await iterator.next();
    assert.equal(exhausted.done, true);
    assert.equal(opened.length, 6);

    client.off('commandSucceeded', observe);
    const independent = mongodb({ uri, db: dbName });
    await independent.open();
    assert.equal(await independent.count(), 130);
    await independent.close();
  } finally {
    client.off('commandSucceeded', observe);
    for (const id of ids) {
      await storage.remove(id);
    }
    await blog.close();
    assert.equal(await coll.countDocuments({}), 0);
    await client.close();
  }
});

test('MongoDB exact option comparisons retain JSON types and literal strings', async () => {
  assert.ok(uri && dbName);
  const client = new MongoClient(uri, { retryWrites: false });
  await client.connect();
  const storage = mongodb({ client, db: dbName });
  const blog = yamb({
    storage,
    options: z.strictObject({
      value: z
        .union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.boolean())])
        .optional()
    })
  });
  const ids = [];
  await blog.open();
  try {
    for (const [i, value] of [
      false,
      true,
      0,
      1,
      '1',
      null,
      [true],
      undefined,
      "'; --",
      '$options.value'
    ].entries()) {
      const raw = await storage.save({
        uri: `drafts/scalar-${i}`,
        slug: `scalar-${i}`,
        title: `Scalar ${i}`,
        text: 'literal',
        status: 'draft',
        tags: [],
        links: { related: [] },
        createdAt: instant,
        updatedAt: instant,
        options: value === undefined ? {} : { value }
      });
      ids.push(raw.id);
    }

    for (const value of [false, true, 0, 1, '1', null, "'; --", '$options.value']) {
      const matches = await blog.all({ options: { value } }).toArray();
      assert.equal(matches.length, 1);
      assert.equal(matches[0].options.value, value);
      assert.equal(await blog.all({ options: { value } }).limit(0).count(), 1);
    }

    const coll = client.db(dbName).collection('posts');

    for (const value of [Long.fromNumber(1), Decimal128.fromString('1'), new Double(1)]) {
      const update = await coll.updateOne(
        { _id: new ObjectId(ids[3]) },
        { $set: { 'options.value': value } }
      );
      assert.equal(update.modifiedCount, 1);
      assert.equal(await blog.all({ options: { value: 1 } }).count(), 1);
    }
  } finally {
    for (const id of ids) {
      await storage.remove(id);
    }
    await blog.close();
    await client.close();
  }
});

test('MongoDB option defaults match missing fields through index bounds', async () => {
  assert.ok(uri && dbName);
  const client = new MongoClient(uri, { retryWrites: false });
  await client.connect();
  const coll = client.db(dbName).collection('posts');
  const storage = mongodb({ client, db: dbName });
  const flag = z.union([z.boolean(), z.null(), z.array(z.union([z.boolean(), z.null()]))]);
  const blog = yamb({
    storage,
    options: z.strictObject({ homepage: flag.default(true), card: flag.default(null) })
  });
  const ids = [];
  let index;

  try {
    await blog.open();
    index = await coll.createIndex(
      { status: 1, 'options.homepage': 1, publishedAt: -1, uri: -1 },
      { name: 'yamb_test_option_defaults' }
    );

    for (const [i, options] of [
      { homepage: true },
      { homepage: false },
      {},
      { homepage: null, card: null },
      { homepage: [true], card: [null] },
      { homepage: [false, true], card: true },
      { homepage: [null], card: [] },
      { homepage: [] },
      [{ homepage: true, card: null }]
    ].entries()) {
      const raw = await storage.save({
        uri: `2026/11/homepage-${i}`,
        slug: `homepage-${i}`,
        title: `Homepage ${i}`,
        text: 'literal',
        status: 'published',
        tags: [],
        links: { related: [] },
        createdAt: instant,
        updatedAt: instant,
        publishedAt: instant,
        options
      });
      ids.push(raw.id);
    }

    for (const [options, expected] of [
      [{ homepage: true }, [2, 0]],
      [{ homepage: false }, [1]],
      [{ homepage: null }, [3]],
      [{ card: null }, [7, 3, 2, 1, 0]],
      [{ card: true }, [5]]
    ]) {
      const posts = await blog.all({ options }).toArray();
      assert.deepEqual(
        posts.map((post) => post.title),
        expected.map((i) => `Homepage ${i}`)
      );
    }

    const filter = buildMongoFilter({ status: 'published', options: { homepage: true } }, true, {
      homepage: true,
      card: null
    });
    const cursor = coll.find(filter, { sort: buildMongoSort(undefined), hint: index });
    const plan = await cursor.explain('queryPlanner');
    const { winningPlan } = plan.queryPlanner;
    const hinted = await cursor.toArray();

    assert.deepEqual(
      hinted.map((post) => post.uri),
      ['2026/11/homepage-2', '2026/11/homepage-0']
    );
    assert.equal(await blog.all({ status: 'published', options: { homepage: true } }).count(), 2);
    assert.deepEqual(stages(winningPlan, 'SORT'), []);
    assert.deepEqual(
      stages(winningPlan, 'IXSCAN')
        .flatMap((scan) => scan.indexBounds['options.homepage'])
        .toSorted(),
      ['[null, null]', '[true, true]']
    );
  } finally {
    try {
      for (const id of ids) {
        await storage.remove(id);
      }

      await blog.close();
    } finally {
      try {
        if (index) {
          await coll.dropIndex(index);
        }
      } finally {
        await client.close();
      }
    }
  }
});
