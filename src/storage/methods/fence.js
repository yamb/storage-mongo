import { ObjectId } from 'mongodb';

import { StorageNotOpenError, PostNotFoundError, StorageWriteError } from '#core/errors';

import { driverAbort } from '../abort.js';
import { classify } from '../errors.js';
import { getState } from '../internal.js';
import { guard, mismatch } from '../version.js';

export default {
  name: 'fence',

  async fn(storage, id, version, options = {}) {
    const { signal, expected } = options;
    const state = getState(storage);

    if (!state.collection) {
      throw new StorageNotOpenError();
    }

    signal?.throwIfAborted();

    if (typeof id !== 'string' || !ObjectId.isValid(id)) {
      throw new PostNotFoundError('post id not found');
    }

    if (typeof version !== 'string' || !version.isWellFormed()) {
      throw new StorageWriteError('version must be a well-formed string');
    }

    using abort = signal ? driverAbort(signal) : null;

    try {
      const _id = new ObjectId(id);
      const result = await state.collection.updateOne(
        guard(_id, expected),
        { $set: { version } },
        { signal: abort?.signal }
      );

      if (!result.acknowledged) {
        throw new StorageWriteError('mongodb fence was not acknowledged');
      }

      if (result.matchedCount === 0) {
        throw await mismatch(state.collection, _id, expected, abort?.signal);
      }
    } catch (error) {
      throw classify(error, 'fence', signal, StorageWriteError, abort);
    }
  }
};
