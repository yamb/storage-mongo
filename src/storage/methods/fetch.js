import { StorageNotOpenError, StorageReadError } from '#core/errors';

import { driverAbort } from '../abort.js';
import { classify } from '../errors.js';
import { getState } from '../internal.js';
import { hydrateRaw } from './hydrate.js';

export default {
  name: 'fetch',

  async fn(storage, uri, options = {}) {
    const { signal } = options;
    const state = getState(storage);

    if (!state.collection) {
      throw new StorageNotOpenError();
    }

    if (typeof uri !== 'string') {
      throw new StorageReadError('uri must be a string');
    }

    signal?.throwIfAborted();

    using abort = signal ? driverAbort(signal) : null;

    try {
      const doc = await state.collection.findOne({ uri }, { signal: abort?.signal });

      return hydrateRaw(doc);
    } catch (error) {
      throw classify(error, 'fetch', signal, StorageReadError, abort);
    }
  }
};
