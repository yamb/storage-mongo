import { StorageReadError } from '#core/errors';

import { driverAbort } from '../abort.js';
import { classify } from '../errors.js';
import { getState, ready } from '../internal.js';
import { hydrateRaw } from './hydrate.js';

export default {
  name: 'fetch',

  async fn(storage, uri, options = {}) {
    const { signal } = options;
    const collection = ready(getState(storage));

    if (typeof uri !== 'string') {
      throw new StorageReadError('uri must be a string');
    }

    signal?.throwIfAborted();

    using abort = signal ? driverAbort(signal) : null;

    try {
      return hydrateRaw(await collection.findOne({ uri }, { signal: abort?.signal }));
    } catch (error) {
      throw classify(error, 'fetch', StorageReadError, abort);
    }
  }
};
