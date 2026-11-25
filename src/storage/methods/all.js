import { QueryValidationError, StorageReadError } from '#core/errors';
import { LimitSchema, OffsetSchema } from '#core/schemas';

import { buildMongoFilter } from '../../query/filter.js';
import { buildMongoSort } from '../../query/sort.js';
import { driverAbort } from '../abort.js';
import { iterateCursor } from '../cursor.js';
import { classify } from '../errors.js';
import { getState, ready } from '../internal.js';
import { hydrateRaw } from './hydrate.js';

function check(schema, field, value, expected) {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new QueryValidationError(`options.${field} must be ${expected}`, {
      details: { field, issues: result.error.issues }
    });
  }
}

export default {
  name: 'all',

  fn(storage, query = {}, options = {}) {
    const { signal, order, limit = null, offset = 0 } = options;
    signal?.throwIfAborted();
    const state = getState(storage);
    ready(state);
    check(LimitSchema, 'limit', limit, 'a non-negative integer or null');
    check(OffsetSchema, 'offset', offset, 'a non-negative integer');

    const sort = buildMongoSort(order);
    const filter = buildMongoFilter(query, sort.uri === -1, state.optionDefaults);
    const page = limit === null ? { sort, skip: offset } : { sort, skip: offset, limit };

    return {
      async *[Symbol.asyncIterator]() {
        signal?.throwIfAborted();

        if (limit === 0) {
          return;
        }

        using abort = signal ? driverAbort(signal) : null;
        const create = () => ready(state).find(filter, { ...page, signal: abort?.signal });

        try {
          for await (const doc of iterateCursor(create, abort?.signal)) {
            signal?.throwIfAborted();
            yield hydrateRaw(doc);
          }
        } catch (error) {
          throw classify(error, 'all', StorageReadError, abort);
        }
      }
    };
  }
};
