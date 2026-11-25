import { PostNotFoundError, StorageWriteError } from '#core/errors';

import { driverAbort } from '../abort.js';
import { classify } from '../errors.js';
import { getState, objectId, ready } from '../internal.js';
import { guard, mismatch } from '../version.js';

export default {
  name: 'fence',

  async fn(storage, id, version, options = {}) {
    const { signal, expected } = options;
    const collection = ready(getState(storage));
    signal?.throwIfAborted();
    const _id = objectId(id);

    if (!_id) {
      throw new PostNotFoundError('post id not found');
    }

    if (typeof version !== 'string' || !version.isWellFormed()) {
      throw new StorageWriteError('version must be a well-formed string');
    }

    using abort = signal ? driverAbort(signal) : null;

    try {
      const result = await collection.updateOne(
        guard(_id, expected),
        { $set: { version } },
        { signal: abort?.signal }
      );

      if (!result.acknowledged) {
        throw new StorageWriteError('mongodb fence was not acknowledged');
      }

      if (result.matchedCount === 0) {
        throw await mismatch(collection, _id, expected, abort?.signal);
      }
    } catch (error) {
      throw classify(error, 'fence', StorageWriteError, abort);
    }
  }
};
