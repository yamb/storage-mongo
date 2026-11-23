import assert from 'node:assert/strict';
import nodeTest from 'node:test';

import { mongodb as createStorage } from '@meritt/yamb-storage-mongo';
import { MongoClient, ObjectId } from 'mongodb';

export const uri = process.env.MONGO_URI;
export const dbName = process.env.YAMB_MONGO_DB;
const owned = new Set();
const storages = new Set();

export function mongodb(config = {}) {
  const storage = createStorage(
    config.client ? { db: dbName, ...config } : { uri, db: dbName, ...config }
  );
  const save = storage.save.bind(storage);

  Object.defineProperty(storage, 'save', {
    value: async (...args) => {
      const result = await save(...args);
      owned.add(result.id);

      return result;
    }
  });
  storages.add(storage);

  return storage;
}

export function test(name, fn) {
  return nodeTest(name, async (t) => {
    if (!uri || !dbName) {
      t.skip('requires MONGO_URI and YAMB_MONGO_DB with prepared posts structure');
      return;
    }

    assert.match(dbName, /^yamb_test_/);
    const client = new MongoClient(uri, { retryWrites: false, serverSelectionTimeoutMS: 3000 });

    try {
      await client.connect();
      const db = client.db(dbName);
      const collections = await db.listCollections({ name: 'posts' }, { nameOnly: true }).toArray();
      assert.equal(collections.length, 1, 'prepared Mongo posts collection must exist');
      const collection = db.collection('posts');
      assert.equal(await collection.countDocuments({}), 0, 'prepared Mongo must be empty');

      try {
        await fn(t);
      } finally {
        for (const storage of storages) {
          await storage.close();
        }
        storages.clear();

        if (owned.size) {
          await collection.deleteMany({ _id: { $in: [...owned].map((id) => new ObjectId(id)) } });
          owned.clear();
        }
      }
    } finally {
      await client.close();
    }
  });
}
