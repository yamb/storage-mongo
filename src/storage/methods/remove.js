import { PostNotFoundError, StorageWriteError } from '#core/errors';

import { driverAbort } from '../abort.js';
import { classify } from '../errors.js';
import { getState, objectId, ready } from '../internal.js';
import { guard, mismatch } from '../version.js';

export default {
  name: 'remove',

  async fn(storage, id, options = {}) {
    const { signal, expected } = options;
    const collection = ready(getState(storage));
    signal?.throwIfAborted();
    const _id = objectId(id);

    if (!_id) {
      throw new PostNotFoundError('post id not found');
    }

    using abort = signal ? driverAbort(signal) : null;

    try {
      const result = await collection.deleteOne(guard(_id, expected), { signal: abort?.signal });

      if (!result.acknowledged) {
        throw new StorageWriteError('mongodb removal was not acknowledged');
      }

      if (result.deletedCount === 0) {
        throw await mismatch(collection, _id, expected, abort?.signal);
      }
    } catch (error) {
      throw classify(error, 'remove', StorageWriteError, abort);
    }
  }
};
