import { isDeepStrictEqual } from 'node:util';

import { MongoClient } from 'mongodb';

import { MongoConnectionError, MongoIndexError } from '../../errors/index.js';
import { driverAbort } from '../abort.js';
import { getState } from '../internal.js';

const indexes = [
  { uri: 1 },
  { status: 1, publishedAt: -1, uri: -1 },
  { publishedAt: -1 },
  { createdAt: -1 },
  { updatedAt: -1 },
  { status: 1, title: 1, uri: 1 },
  { status: 1, createdAt: -1, uri: -1 },
  { status: 1, updatedAt: -1, uri: -1 },
  { tags: 1 },
  { 'links.related': 1 }
];

function matches(index, key) {
  return (
    isDeepStrictEqual(Object.entries(index.key), Object.entries(key)) &&
    !index.partialFilterExpression &&
    !index.sparse &&
    !index.hidden &&
    !index.collation &&
    (Object.keys(key).length !== 1 || !Object.hasOwn(key, 'uri') || index.unique === true)
  );
}

async function acquire(state, defaults, signal) {
  using abort = signal ? driverAbort(signal) : null;
  const { config } = state;
  let { client } = config;

  try {
    client ??= new MongoClient(config.uri, { retryWrites: false });
    await client.connect();
    abort?.signal?.throwIfAborted();

    const db = client.db(config.db);
    const [info] = await db
      .listCollections({ name: config.collection }, { signal: abort?.signal })
      .toArray();

    if (info?.type !== 'collection' || info.options?.collation) {
      throw new MongoIndexError(
        'existing MongoDB database requires the Yamb collection without a default collation'
      );
    }

    const collection = db.collection(config.collection);
    const existing = await collection.listIndexes({ signal: abort?.signal }).toArray();

    for (const key of indexes) {
      if (!existing.some((index) => matches(index, key))) {
        throw new MongoIndexError('existing Yamb collection is missing a required index', {
          details: { key }
        });
      }
    }

    abort?.signal.throwIfAborted();

    state.client = client;
    state.collection = collection;
    state.optionDefaults = defaults;
  } catch (cause) {
    if (!config.client && client) {
      try {
        await client.close();
      } catch {
        // Cleanup cannot replace the failed acquisition reason.
      }
    }

    if (abort?.cancelled(cause)) {
      throw abort.reason;
    }

    if (cause instanceof MongoIndexError) {
      throw cause;
    }

    throw new MongoConnectionError('failed to open existing MongoDB storage', { cause });
  }
}

export default {
  name: 'open',

  async fn(storage, context = {}) {
    const { signal } = context;
    signal?.throwIfAborted();

    const state = getState(storage);
    const defaults = structuredClone(context.optionDefaults ?? {});

    if (state.closing) {
      await state.closing;
      signal?.throwIfAborted();
    }

    if (state.collection) {
      return;
    }

    if (state.opening) {
      return state.opening;
    }

    state.opening = acquire(state, defaults, signal);

    try {
      await state.opening;
    } finally {
      state.opening = null;
    }
  }
};
