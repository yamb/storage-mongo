import { StorageReadError } from '#core/errors';

import { driverAbort } from '../abort.js';
import { iterateCursor } from '../cursor.js';
import { classify } from '../errors.js';
import { getState, ready } from '../internal.js';

export default {
  name: 'entries',

  fn(storage, options = {}) {
    const { signal } = options;
    const state = getState(storage);
    ready(state);

    return {
      async *[Symbol.asyncIterator]() {
        signal?.throwIfAborted();
        using abort = signal ? driverAbort(signal) : null;
        const create = () =>
          ready(state).find({}, { projection: { _id: 1, uri: 1 }, signal: abort?.signal });

        try {
          for await (const doc of iterateCursor(create, abort?.signal)) {
            signal?.throwIfAborted();
            yield [doc._id.toString(), doc.uri];
          }
        } catch (error) {
          throw classify(error, 'entries', StorageReadError, abort);
        }
      }
    };
  }
};
