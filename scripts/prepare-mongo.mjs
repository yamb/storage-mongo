import assert from 'node:assert/strict';

import { MongoClient } from 'mongodb';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');

const uri = 'mongodb://127.0.0.1:27017/?directConnection=true';
const name = 'yamb_test_actions';

await using client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
const db = client.db(name);
assert.equal(await db.listCollections().hasNext(), false, 'Expected a fresh MongoDB database');

const posts = await db.createCollection('posts');
await posts.createIndexes([
  { key: { uri: 1 }, unique: true },
  { key: { status: 1, publishedAt: -1, uri: -1 } },
  { key: { publishedAt: -1 } },
  { key: { createdAt: -1 } },
  { key: { updatedAt: -1 } },
  { key: { status: 1, title: 1, uri: 1 } },
  { key: { status: 1, createdAt: -1, uri: -1 } },
  { key: { status: 1, updatedAt: -1, uri: -1 } },
  { key: { tags: 1 } },
  { key: { 'links.related': 1 } }
]);
