import { StorageReadError } from '#core/errors';

import { buildMongoFilter } from '../../query/filter.js';
import { driverAbort } from '../abort.js';
import { classify } from '../errors.js';
import { getState, ready } from '../internal.js';

export default {
  name: 'count',

  async fn(storage, query = {}, options = {}) {
    const { signal } = options;
    signal?.throwIfAborted();
    const state = getState(storage);
    const collection = ready(state);
    const filter = buildMongoFilter(query, true, state.optionDefaults);

    using abort = signal ? driverAbort(signal) : null;

    try {
      return await collection.countDocuments(filter, { signal: abort?.signal });
    } catch (error) {
      throw classify(error, 'count', StorageReadError, abort);
    }
  }
};
