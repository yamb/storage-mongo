import { ObjectId } from 'mongodb';

import { StorageNotOpenError, StorageReadError } from '#core/errors';

import { driverAbort } from '../abort.js';
import { classify } from '../errors.js';
import { getState } from '../internal.js';
import { hydrateRaw } from './hydrate.js';

export default {
  name: 'find',

  async fn(storage, id, options = {}) {
    const { signal } = options;
    const state = getState(storage);

    if (!state.collection) {
      throw new StorageNotOpenError();
    }

    if (typeof id !== 'string') {
      throw new StorageReadError('id must be a string');
    }

    signal?.throwIfAborted();

    if (!ObjectId.isValid(id)) {
      return null;
    }

    using abort = signal ? driverAbort(signal) : null;

    try {
      const doc = await state.collection.findOne(
        { _id: new ObjectId(id) },
        { signal: abort?.signal }
      );

      return hydrateRaw(doc);
    } catch (error) {
      throw classify(error, 'find', signal, StorageReadError, abort);
    }
  }
};
