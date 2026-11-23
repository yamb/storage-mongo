import { StorageNotOpenError, StorageReadError, QueryValidationError } from '#core/errors';
import { LimitSchema, OffsetSchema } from '#core/schemas';

import { buildMongoFilter } from '../../query/filter.js';
import { buildMongoSort } from '../../query/sort.js';
import { driverAbort } from '../abort.js';
import { iterateCursor } from '../cursor.js';
import { classify } from '../errors.js';
import { getState } from '../internal.js';
import { hydrateRaw } from './hydrate.js';

function validatePage(options) {
  if (options.limit !== undefined) {
    const result = LimitSchema.safeParse(options.limit);

    if (!result.success) {
      throw new QueryValidationError(`options.limit must be a non-negative integer or null`, {
        details: { field: 'limit', issues: result.error.issues }
      });
    }
  }

  if (options.offset !== undefined) {
    const result = OffsetSchema.safeParse(options.offset);

    if (!result.success) {
      throw new QueryValidationError(`options.offset must be a non-negative integer`, {
        details: { field: 'offset', issues: result.error.issues }
      });
    }
  }
}

export default {
  name: 'all',

  fn(storage, query = {}, options = {}) {
    const { signal } = options;
    signal?.throwIfAborted();
    const state = getState(storage);

    if (!state.collection) {
      throw new StorageNotOpenError();
    }

    validatePage(options);

    const descending = (options.order ?? '-publishedAt').startsWith('-');
    const filter = buildMongoFilter(query, descending, state.optionDefaults);
    const sort = buildMongoSort(options.order);

    return {
      async *[Symbol.asyncIterator]() {
        signal?.throwIfAborted();

        if (options.limit === 0) {
          return;
        }

        using abort = signal ? driverAbort(signal) : null;
        const create = () => {
          const page = { sort, signal: abort?.signal };

          if (options.limit != null) {
            page.limit = options.limit;
          }

          if (options.offset !== undefined) {
            page.skip = options.offset;
          }

          return state.collection.find(filter, page);
        };

        try {
          for await (const doc of iterateCursor(create, abort?.signal)) {
            signal?.throwIfAborted();
            yield hydrateRaw(doc);
          }
        } catch (error) {
          throw classify(error, 'all', signal, StorageReadError, abort);
        }
      }
    };
  }
};
