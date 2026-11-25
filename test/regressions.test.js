import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';

import { MongoClient } from 'mongodb';

import { mongodb, test, uri, dbName } from './prepared-mongodb.js';

const instant = '2026-11-12T12:00:00.000000000Z';

function raw(slug) {
  return {
    uri: `2026/11/${slug}`,
    slug,
    title: slug,
    text: 'source 😀',
    preview: '',
    cover: { caption: 'caption' },
    status: 'published',
    tags: ['restricted'],
    links: { related: [] },
    options: { nested: { value: 'original' } },
    createdAt: instant,
    updatedAt: instant,
    publishedAt: instant
  };
}

test('concurrent owned opens acquire and release one real client', async (t) => {
  const clients = new Set();
  const { connect } = MongoClient.prototype;
  t.mock.method(MongoClient.prototype, 'connect', function (...args) {
    clients.add(this);
    return connect.apply(this, args);
  });

  const storage = mongodb();

  try {
    await Promise.all(Array.from({ length: 5 }, () => storage.open()));
    assert.equal(clients.size, 1);

    await Promise.all(Array.from({ length: 5 }, () => storage.close()));
    for (const client of clients) {
      await assert.rejects(() => client.db(dbName).collection('posts').countDocuments({}), {
        name: 'MongoNotConnectedError'
      });
    }

    await storage.open();
    assert.equal(await storage.count(), 0);
  } finally {
    await storage.close();
    for (const client of clients) {
      await client.close();
    }
  }
});

test('close joins pending open and an open during close starts a new generation', async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();

  class Client extends MongoClient {
    calls = 0;

    async connect() {
      this.calls++;

      if (this.calls === 1) {
        entered.resolve();
        await release.promise;
      }

      return super.connect();
    }
  }

  const client = new Client(uri, { retryWrites: false });
  const storage = mongodb({ client });
  const pending = [];

  try {
    const opening = storage.open({ optionDefaults: { flag: true } });
    pending.push(opening);
    await entered.promise;

    let closed = false;
    const closing = (async () => {
      await storage.close();
      closed = true;
    })();
    const reopened = storage.open({ optionDefaults: { flag: false } });
    pending.push(closing, reopened);

    await Promise.resolve();
    assert.equal(closed, false);

    release.resolve();
    await Promise.all([opening, closing, reopened]);
    assert.equal(client.calls, 2);
    assert.equal(await storage.count({ options: { flag: false } }), 0);

    await storage.close();
    await assert.rejects(() => storage.count(), { code: 'YAMB_STORAGE_NOT_OPEN' });
    assert.equal(await client.db(dbName).collection('posts').countDocuments({}), 0);
  } finally {
    release.resolve();
    await Promise.allSettled(pending);
    await storage.close();
    await client.close();
  }
});

test('coalesced opens retain the first context snapshot and can retry after abort', async () => {
  const client = new MongoClient(uri, { retryWrites: false, monitorCommands: true });
  const storage = mongodb({ client });

  try {
    const defaults = { flag: true };
    const first = storage.open({ optionDefaults: defaults });
    const controller = new AbortController();
    const joined = storage.open({ signal: controller.signal, optionDefaults: { flag: false } });

    defaults.flag = false;
    controller.abort(new Error('other caller'));

    await Promise.all([first, joined]);
    await storage.save(raw('defaults'));
    assert.equal(await storage.count({ options: { flag: true } }), 1);
    await storage.close();

    const reason = { stop: true };
    const abort = new AbortController();
    const listener = (event) => {
      if (event.commandName === 'listIndexes') {
        abort.abort(reason);
      }
    };
    client.on('commandStarted', listener);
    try {
      await assert.rejects(
        () => storage.open({ signal: abort.signal }),
        (e) => e === reason
      );
    } finally {
      client.off('commandStarted', listener);
    }

    await storage.open();
    assert.equal(await storage.count(), 1);
  } finally {
    await storage.close();
    await client.close();
  }
});

test('invalid tags and unknown query keys fail before querying while valid tags match all', async () => {
  const client = new MongoClient(uri, { retryWrites: false, monitorCommands: true });
  const storage = mongodb({ client });

  try {
    await storage.open();
    await storage.save(raw('restricted'));
    await storage.save({ ...raw('other'), tags: ['other'] });

    let commands = 0;
    client.on('commandStarted', () => {
      commands++;
    });

    for (const query of [
      ...[
        null,
        'restricted',
        1,
        { $all: ['restricted'] },
        [null],
        [1],
        [''],
        ['x'.repeat(65)],
        Array(1),
        Array(51).fill('restricted')
      ].map((tags) => ({ tags })),
      { tag: 'restricted' },
      { tags: ['restricted'], $where: 'true' }
    ]) {
      await assert.rejects(() => storage.count(query), { code: 'YAMB_QUERY_VALIDATION' });
      assert.throws(() => storage.all(query), { code: 'YAMB_QUERY_VALIDATION' });
    }
    assert.equal(commands, 0);

    assert.equal(await storage.count({ tags: [] }), 2);
    assert.equal(await storage.count({ tags: ['restricted', 'other'] }), 0);
    assert.equal(await storage.count({ tags: ['restricted'] }), 1);
    assert.equal(await storage.count({ tags: Array(50).fill('restricted') }), 1);
  } finally {
    await storage.close();
    await client.close();
  }
});

test('unrepresentable BSON strings and nested keys fail before DML', async () => {
  const client = new MongoClient(uri, { retryWrites: false, monitorCommands: true });
  const storage = mongodb({ client });

  try {
    await storage.open();
    const saved = await storage.save(raw('unicode'));

    let writes = 0;
    client.on('commandStarted', (event) => {
      if (['insert', 'update'].includes(event.commandName)) {
        writes++;
      }
    });

    for (const field of ['text', 'title', 'preview', 'uri', 'slug', 'status', 'createdAt']) {
      await assert.rejects(() => storage.save({ ...raw('bad'), [field]: '\ud800' }), {
        code: 'YAMB_STORAGE_WRITE'
      });
    }

    for (const patch of [
      { cover: { caption: '\udfff' } },
      { options: { nested: ['\ud800'] } },
      { options: { nested: { ['bad\ud800']: true } } },
      { tags: ['\ud800'] },
      { ['bad\ud800']: 'value' },
      { cover: { ['bad\ud800']: 'value' } }
    ]) {
      await assert.rejects(() => storage.save({ ...saved, ...patch }), {
        code: 'YAMB_STORAGE_WRITE'
      });
    }
    assert.equal(writes, 0);

    const unchanged = await storage.find(saved.id);
    assert.equal(unchanged.text, saved.text);
    assert.equal(await storage.count(), 1);

    const text = '😀'.repeat(524288);
    await storage.save({ ...saved, text, options: { ['valid.💡$']: ['中文', null, 2] } });
    const loaded = await storage.find(saved.id);
    assert.equal(loaded.text, text);
  } finally {
    await storage.close();
    await client.close();
  }
});

test('save owns nested values before driver encoding yields to its caller', async () => {
  const storage = mongodb();
  await storage.open();
  const input = raw('snapshot');
  const pending = storage.save(input);

  input.options.nested.value = '\ud800';
  input.cover.caption = '\ud800';
  input.tags.push('\ud800');

  const saved = await pending;
  const loaded = await storage.find(saved.id);

  assert.equal(saved.options.nested.value, 'original');
  assert.equal(loaded.options.nested.value, 'original');
  assert.equal(loaded.cover.caption, 'caption');
  assert.deepEqual(loaded.tags, ['restricted']);
});

test('active driver operations preserve every native abort reason and release listeners', async () => {
  const client = new MongoClient(uri, { retryWrites: false, monitorCommands: true });
  const storage = mongodb({ client });

  try {
    await storage.open();
    const saved = await storage.save(raw('abort'));

    for (const reason of [
      { stop: true },
      null,
      'stop',
      NaN,
      new Error('stop'),
      new DOMException('stop', 'AbortError')
    ]) {
      for (const op of ['find', 'fetch', 'count', 'all', 'entries', 'save', 'open', 'remove']) {
        const removal =
          op === 'remove' ? await storage.save(raw(`remove-${String(reason)}`)) : null;
        const controller = new AbortController();
        const options = { signal: controller.signal };
        const other = op === 'open' ? mongodb({ client }) : null;
        const command = {
          find: 'find',
          fetch: 'find',
          count: 'aggregate',
          all: 'find',
          entries: 'find',
          save: 'update',
          open: 'listIndexes',
          remove: 'delete'
        }[op];

        let fired = 0;
        const listener = (event) => {
          if (event.commandName === command) {
            fired++;
            controller.abort(reason);
          }
        };
        client.on('commandStarted', listener);

        try {
          const run = () => {
            if (op === 'find') {
              return storage.find(saved.id, options);
            }

            if (op === 'fetch') {
              return storage.fetch(saved.uri, options);
            }

            if (op === 'count') {
              return storage.count({}, options);
            }

            if (op === 'all') {
              return Array.fromAsync(storage.all({}, options));
            }

            if (op === 'entries') {
              return Array.fromAsync(storage.entries(options));
            }

            if (op === 'save') {
              return storage.save(saved, options);
            }

            if (op === 'open') {
              return other.open(options);
            }

            return storage.remove(removal.id, options);
          };

          await assert.rejects(run, (error) => Object.is(error, reason));
          assert.equal(fired, 1);
          assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
        } finally {
          client.off('commandStarted', listener);
          await other?.close();
        }
      }
    }
  } finally {
    await storage.close();
    await client.close();
  }
});

test('suspended cursors preserve NaN and close before rejecting the next step', async () => {
  const storage = mongodb();
  await storage.open();
  await storage.save(raw('nan'));

  for (const iterable of [
    (signal) => storage.all({}, { signal }),
    (signal) => storage.entries({ signal })
  ]) {
    const controller = new AbortController();
    const iterator = iterable(controller.signal)[Symbol.asyncIterator]();
    await iterator.next();

    controller.abort(NaN);
    await assert.rejects(
      () => iterator.next(),
      (error) => Object.is(error, NaN)
    );

    await iterator.return();
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
});

test('owned acquisition failure preserves its primary cause and leaves a retryable instance', async (t) => {
  const primary = new Error('connect failed after acquisition');
  const cleanup = new Error('close failed after release');
  const { connect, close } = MongoClient.prototype;
  const clients = new Set();
  let fail = true;

  t.mock.method(MongoClient.prototype, 'connect', async function (...args) {
    clients.add(this);
    await connect.apply(this, args);

    if (fail) {
      throw primary;
    }

    return this;
  });
  t.mock.method(MongoClient.prototype, 'close', async function (...args) {
    await close.apply(this, args);

    if (fail) {
      throw cleanup;
    }
  });

  const storage = mongodb();

  try {
    const opening = storage.open();
    const joined = storage.open();
    const closing = storage.close();

    for (const result of await Promise.allSettled([opening, joined])) {
      assert.equal(result.status, 'rejected');
      assert.equal(result.reason.cause, primary);
    }

    await closing;
    assert.equal(clients.size, 1);

    fail = false;
    await storage.open();
    assert.equal(await storage.count(), 0);
    assert.equal(clients.size, 2);
  } finally {
    fail = false;
    await storage.close();
    for (const client of clients) {
      await close.call(client);
    }
  }
});

test('owned close is coalesced and reopen waits for actual client release', async (t) => {
  const storage = mongodb();
  await storage.open();

  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const { close } = MongoClient.prototype;
  let calls = 0;
  t.mock.method(MongoClient.prototype, 'close', async function (...args) {
    calls++;
    entered.resolve();
    await release.promise;
    return close.apply(this, args);
  });

  const pending = [];

  try {
    pending.push(storage.close());
    await entered.promise;

    pending.push(storage.close());
    let opened = false;
    const reopened = (async () => {
      await storage.open();
      opened = true;
    })();
    pending.push(reopened);

    await Promise.resolve();
    assert.equal(opened, false);
    assert.equal(calls, 1);

    release.resolve();
    await Promise.all(pending);
    assert.equal(await storage.count(), 0);
  } finally {
    release.resolve();
    await Promise.allSettled(pending);
    await storage.close();
  }
});

test('late abort preserves independent duplicate failure and an acknowledged write result', async () => {
  const client = new MongoClient(uri, { retryWrites: false, monitorCommands: true });
  const storage = mongodb({ client });

  try {
    await storage.open();
    const saved = await storage.save(raw('late-abort'));

    const failed = new AbortController();
    const fail = (event) => {
      if (event.commandName === 'insert') {
        failed.abort({ late: true });
      }
    };
    client.on('commandSucceeded', fail);
    try {
      await assert.rejects(() => storage.save(raw('late-abort'), { signal: failed.signal }), {
        code: 'YAMB_STORAGE_DUPLICATE'
      });
      assert.equal(failed.signal.aborted, true);
    } finally {
      client.off('commandSucceeded', fail);
    }

    const succeeded = new AbortController();
    const succeed = (event) => {
      if (event.commandName === 'update') {
        succeeded.abort({ late: true });
      }
    };
    client.on('commandSucceeded', succeed);
    try {
      const result = await storage.save(
        { ...saved, text: 'acknowledged' },
        { signal: succeeded.signal }
      );
      assert.equal(succeeded.signal.aborted, true);
      assert.equal(result.text, 'acknowledged');
      assert.equal(getEventListeners(succeeded.signal, 'abort').length, 0);
    } finally {
      client.off('commandSucceeded', succeed);
    }

    const loaded = await storage.find(saved.id);
    assert.equal(loaded.text, 'acknowledged');
  } finally {
    await storage.close();
    await client.close();
  }
});

test('operations keep their original signal when caller options change during await or yield', async () => {
  const client = new MongoClient(uri, { retryWrites: false, monitorCommands: true });
  const storage = mongodb({ client });

  try {
    await storage.open();
    const saved = await storage.save(raw('captured-signal'));

    const controller = new AbortController();
    const reason = { original: true };
    const options = { signal: controller.signal };
    const listener = (event) => {
      if (event.commandName === 'find') {
        options.signal = AbortSignal.abort('unrelated');
        controller.abort(reason);
      }
    };
    client.on('commandStarted', listener);
    try {
      await assert.rejects(
        () => storage.find(saved.id, options),
        (error) => error === reason
      );
    } finally {
      client.off('commandStarted', listener);
    }

    for (const create of [(opts) => storage.all({}, opts), (opts) => storage.entries(opts)]) {
      const original = new AbortController();
      const opts = { signal: original.signal };
      const iterator = create(opts)[Symbol.asyncIterator]();

      opts.signal = AbortSignal.abort('replaced before next');
      await iterator.next();

      original.abort(NaN);
      opts.signal = new AbortController().signal;

      await assert.rejects(
        () => iterator.next(),
        (error) => Object.is(error, NaN)
      );

      await iterator.return();
      assert.equal(getEventListeners(original.signal, 'abort').length, 0);
    }
  } finally {
    await storage.close();
    await client.close();
  }
});

test('BSON snapshot accepts wide valid JSON and rejects cycles and transport overflow before DML', async () => {
  const client = new MongoClient(uri, { retryWrites: false, monitorCommands: true });
  const storage = mongodb({ client });

  try {
    await storage.open();
    const values = Array.from({ length: 120001 }, (_, i) => i);
    const saved = await storage.save({ ...raw('wide'), options: { values } });
    const loaded = await storage.find(saved.id);
    assert.deepEqual(loaded.options.values, values);

    const payload = 'x'.repeat(16 * 1024 * 1024 - 4096);
    await storage.save({ ...saved, options: { payload } });
    const large = await storage.find(saved.id);
    assert.equal(large.options.payload, payload);

    let nested = { value: 'bottom' };
    for (let i = 0; i < 95; i++) {
      nested = { child: nested };
    }

    await storage.save({ ...saved, options: { nested } });
    const deep = await storage.find(saved.id);
    assert.deepEqual(deep.options.nested, nested);

    let writes = 0;
    client.on('commandStarted', (event) => {
      if (['insert', 'update'].includes(event.commandName)) {
        writes++;
      }
    });

    const cyclic = {};
    cyclic.self = cyclic;
    for (let i = 0; i < 10; i++) {
      nested = { child: nested };
    }

    for (const options of [
      cyclic,
      { nested },
      { oversized: 'x'.repeat(16 * 1024 * 1024) },
      {
        toBSON() {
          return '\ud800';
        }
      },
      { at: Temporal.Instant.from(instant) },
      { at: new Date(0) },
      { lookup: new Map([['key', 'value']]) },
      { bytes: new Uint8Array(1) }
    ]) {
      await assert.rejects(() => storage.save({ ...saved, options }), {
        code: 'YAMB_STORAGE_WRITE'
      });
    }
    assert.equal(writes, 0);
  } finally {
    await storage.close();
    await client.close();
  }
});

test('open rejects a view or a collection with a default collation as unprepared', async () => {
  const client = new MongoClient(uri, { retryWrites: false });
  const db = client.db(dbName);
  const name = `collated_${process.pid}`;
  const view = `view_${process.pid}`;
  const simple = { collation: { locale: 'simple' } };

  try {
    const collated = await db.createCollection(name, { collation: { locale: 'en', strength: 2 } });
    for (const index of await db.collection('posts').listIndexes().toArray()) {
      if (index.name !== '_id_') {
        await collated.createIndex(index.key, index.unique ? { unique: true, ...simple } : simple);
      }
    }
    await db.createCollection(view, { viewOn: 'posts', pipeline: [] });

    for (const collection of [name, view]) {
      const storage = mongodb({ client, collection });
      await assert.rejects(() => storage.open(), { code: 'YAMB_MONGODB_INDEX' });
      await storage.close();
    }
  } finally {
    try {
      await db.collection(view).drop();
      await db.collection(name).drop();
    } finally {
      await client.close();
    }
  }
});

test('aborted owned opening releases its acquired client before close finishes and permits retry', async (t) => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const { connect, close } = MongoClient.prototype;
  let captured;
  let released = false;

  t.mock.method(MongoClient.prototype, 'connect', async function (...args) {
    await connect.apply(this, args);

    if (!captured) {
      captured = this;
      entered.resolve();
      await release.promise;
    }

    return this;
  });
  t.mock.method(MongoClient.prototype, 'close', async function (...args) {
    await close.apply(this, args);

    if (this === captured) {
      released = true;
    }
  });

  const storage = mongodb();
  const controller = new AbortController();
  const reason = { aborted: true };
  const opening = storage.open({ signal: controller.signal });
  const rejected = assert.rejects(opening, (error) => error === reason);
  const closing = storage.close();

  try {
    await entered.promise;

    controller.abort(reason);
    release.resolve();

    await Promise.all([rejected, closing]);
    assert.equal(released, true);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);

    await storage.open();
    assert.equal(await storage.count(), 0);
  } finally {
    release.resolve();
    await Promise.allSettled([rejected, closing]);
    await storage.close();
    if (captured) {
      await close.call(captured);
    }
  }
});
