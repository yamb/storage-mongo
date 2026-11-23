import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { iterateCursor } from '../../src/storage/cursor.js';

test('cursor read failure survives a simultaneous close failure', async () => {
  for (const primary of [
    new Error('read failed'),
    undefined,
    null,
    'read failed',
    { read: false }
  ]) {
    const cursor = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        return Promise.reject(primary);
      },
      async close() {
        throw new Error('close failed');
      }
    };

    await assert.rejects(Array.fromAsync(iterateCursor(() => cursor)), (error) => {
      assert.equal(error, primary);

      return true;
    });
  }
});

test('native abort reason survives rejection of the close already started by abort', async () => {
  for (const reason of [new Error('cancelled'), null, 'cancelled', { cancelled: true }]) {
    const controller = new AbortController();
    const closing = Promise.withResolvers();
    let released = false;
    const cursor = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        return { value: { title: 'Post' }, done: false };
      },
      close() {
        if (released) {
          return Promise.resolve();
        }

        released = true;
        return closing.promise;
      }
    };

    const iterator = iterateCursor(() => cursor, controller.signal);
    const first = await iterator.next();
    assert.equal(first.value.title, 'Post');

    controller.abort(reason);
    const stopped = assert.rejects(iterator.next(), (error) => {
      assert.equal(error, reason);

      return true;
    });

    try {
      assert.equal(
        await Promise.race([stopped.then(() => 'stopped'), setImmediate('closing')]),
        'closing'
      );
    } finally {
      closing.reject(new Error('abort close failed'));
    }

    await stopped;
  }
});

test('ordinary cursor return, break and disposal expose a close failure', async () => {
  for (const finish of [
    (iterator) => iterator.return(),
    async (iterator) => {
      for await (const _ of iterator) {
        break;
      }
    },
    (iterator) => iterator[Symbol.asyncDispose]()
  ]) {
    const cleanup = new Error('close failed');
    const cursor = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        return { value: { title: 'Post' }, done: false };
      },
      async close() {
        throw cleanup;
      }
    };

    const iterator = iterateCursor(() => cursor);
    await iterator.next();
    await assert.rejects(finish(iterator), (error) => error === cleanup);
  }
});
