import { ObjectId } from 'mongodb';

import { StorageNotOpenError, PostNotFoundError, StorageWriteError } from '#core/errors';

import { driverAbort } from '../abort.js';
import { classify } from '../errors.js';
import { getState } from '../internal.js';

export default {
  name: 'remove',

  async fn(storage, id, options = {}) {
    const { signal } = options;
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
      const result = await state.collection.deleteOne(
        { _id: new ObjectId(id) },
        { signal: abort?.signal }
      );

      if (!result.acknowledged) {
        throw new StorageWriteError('mongodb removal was not acknowledged');
      }

      if (result.deletedCount === 0) {
        throw new PostNotFoundError(`id "${id}" not found`);
      }
    } catch (error) {
      throw classify(error, 'remove', signal, StorageWriteError, abort);
    }
  }
};
