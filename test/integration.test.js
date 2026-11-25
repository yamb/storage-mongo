import assert from 'node:assert/strict';

import { MongoClient } from 'mongodb';
import { yamb } from 'yamb';

import { mongodb as createStorage } from '../src/index.js';
import { mongodb, test, uri, dbName } from './prepared-mongodb.js';

const CLOCK = () => Temporal.Instant.from('2026-04-26T12:00:00Z');

function makeBlog() {
  return yamb({
    storage: mongodb({ uri, db: dbName, collection: 'posts' }),
    base: 'https://example.com',
    timeZone: 'UTC',
    clock: CLOCK
  });
}

async function withBlog(fn) {
  const blog = makeBlog();
  await blog.open();

  try {
    await fn(blog);
  } finally {
    await blog[Symbol.asyncDispose]();
  }
}

test('create draft, then publish, then fetch', async () => {
  await withBlog(async (blog) => {
    const post = blog.build({ title: 'Hello, world', text: '## Body' });
    await post.save();
    assert.equal(post.status, 'draft');

    await post.publish();
    assert.equal(post.status, 'published');

    const fetched = await blog.fetch(post.uri);
    assert.equal(fetched.title, 'Hello, world');
  });
});

test('blog.all() includes every status and blog.published selects public posts', async () => {
  await withBlog(async (blog) => {
    await blog.create({ title: 'A', text: '...', status: 'published' });
    await blog.create({ title: 'B', text: '...', status: 'draft' });
    await blog.create({ title: 'C', text: '...', status: 'published' });

    const posts = await blog.all().toArray();
    const titles = posts.map((p) => p.title);
    assert.equal(titles.length, 3);
    assert.equal(await blog.published.count(), 2);
    assert.ok(titles.includes('A'));
    assert.ok(titles.includes('C'));
  });
});

test('scope chain: blog.all({ tags }).published().recent()', async () => {
  await withBlog(async (blog) => {
    await blog.create({
      title: 'JS',
      text: '...',
      status: 'published',
      tags: ['js']
    });

    await blog.create({
      title: 'Ruby',
      text: '...',
      status: 'published',
      tags: ['ruby']
    });

    const posts = await blog
      .all({ tags: ['js'] })
      .published()
      .recent(5)
      .toArray();
    const titles = posts.map((p) => p.title);
    assert.deepEqual(titles, ['JS']);
  });
});

test('rename keeps incoming stable related ids', async () => {
  await withBlog(async (blog) => {
    const arch = await blog.create({
      title: 'Architecture',
      text: '...',
      status: 'published'
    });

    const hello = blog.build({
      title: 'Hello',
      text: '...',
      status: 'published'
    });

    hello.links = { related: [arch.id] };
    await hello.save();

    arch.slug = 'arch';
    await arch.save();

    const refetched = await blog.fetch('2026/04/hello');
    assert.deepEqual(refetched.links.related, [arch.id]);
  });
});

test('for await iterates blog like all()', async () => {
  await withBlog(async (blog) => {
    await blog.create({ title: 'X', text: '...', status: 'published' });
    const titles = [];

    for await (const p of blog) {
      titles.push(p.title);
    }

    assert.deepEqual(titles, ['X']);
  });
});

test('blog.fetch returns null for missing', async () => {
  await withBlog(async (blog) => {
    assert.equal(await blog.fetch('2026/04/missing'), null);
  });
});

test('mongodb({ client }) reuses an official external client without closing it', async () => {
  const url = new URL(uri);
  url.pathname = `/${dbName}`;
  const client = new MongoClient(url.toString());

  const blog = yamb({
    storage: mongodb({ client, db: dbName, collection: 'posts' }),
    base: 'https://example.com',
    timeZone: 'UTC',
    clock: CLOCK
  });

  await blog.open();
  await blog.create({ title: 'External', text: '...', status: 'published' });
  const fetched = await blog.fetch('2026/04/external');
  assert.equal(fetched.title, 'External');
  await blog.close();

  const reusedColl = client.db(dbName).collection('posts');
  const count = await reusedColl.countDocuments({});
  assert.equal(count, 1);
  await client.close();
});

test('mongodb({}) without client and without uri/db is rejected by config validation', () => {
  assert.throws(() => createStorage({}), { code: 'YAMB_MONGODB_CONFIG' });
});

test('mongodb({ client, uri, db }) is rejected (mutually exclusive)', async () => {
  const url = new URL(uri);
  url.pathname = `/${dbName}`;
  const client = new MongoClient(url.toString());

  assert.throws(() => mongodb({ client, uri, db: 'x' }), {
    code: 'YAMB_MONGODB_CONFIG'
  });

  await client.close();
});
