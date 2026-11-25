import { StorageReadError } from '#core/errors';

import { driverAbort } from '../abort.js';
import { classify } from '../errors.js';
import { getState, objectId, ready } from '../internal.js';
import { hydrateRaw } from './hydrate.js';

export default {
  name: 'find',

  async fn(storage, id, options = {}) {
    const { signal } = options;
    const collection = ready(getState(storage));

    if (typeof id !== 'string') {
      throw new StorageReadError('id must be a string');
    }

    signal?.throwIfAborted();

    const _id = objectId(id);

    if (!_id) {
      return null;
    }

    using abort = signal ? driverAbort(signal) : null;

    try {
      return hydrateRaw(await collection.findOne({ _id }, { signal: abort?.signal }));
    } catch (error) {
      throw classify(error, 'find', StorageReadError, abort);
    }
  }
};
