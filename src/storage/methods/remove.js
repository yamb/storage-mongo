import { ObjectId } from 'mongodb';

import { StorageNotOpenError, PostNotFoundError, StorageWriteError } from '#core/errors';

import { driverAbort } from '../abort.js';
import { classify } from '../errors.js';
import { getState } from '../internal.js';
import { guard, mismatch } from '../version.js';

export default {
  name: 'remove',

  async fn(storage, id, options = {}) {
    const { signal, expected } = options;
    const state = getState(storage);

    if (!state.collection) {
      throw new StorageNotOpenError();
    }

    signal?.throwIfAborted();

    if (typeof id !== 'string' || !ObjectId.isValid(id)) {
      throw new PostNotFoundError('post id not found');
    }

    using abort = signal ? driverAbort(signal) : null;

    try {
      const _id = new ObjectId(id);
      const result = await state.collection.deleteOne(guard(_id, expected), {
        signal: abort?.signal
      });

      if (!result.acknowledged) {
        throw new StorageWriteError('mongodb removal was not acknowledged');
      }

      if (result.deletedCount === 0) {
        throw await mismatch(state.collection, _id, expected, abort?.signal);
      }
    } catch (error) {
      throw classify(error, 'remove', signal, StorageWriteError, abort);
    }
  }
};
