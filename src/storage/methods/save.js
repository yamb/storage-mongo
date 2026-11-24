import { ObjectId } from 'mongodb';

import { StorageNotOpenError, StorageWriteError } from '#core/errors';

import { driverAbort } from '../abort.js';
import { capture } from '../capture.js';
import { classify } from '../errors.js';
import { getState } from '../internal.js';
import { guard, mismatch } from '../version.js';
import { hydrateRaw } from './hydrate.js';

export default {
  name: 'save',

  async fn(storage, rawInput, options = {}) {
    const { signal, expected } = options;
    const state = getState(storage);

    if (!state.collection) {
      throw new StorageNotOpenError();
    }

    signal?.throwIfAborted();

    using abort = signal ? driverAbort(signal) : null;

    try {
      const { id, ...raw } = rawInput;
      const doc = capture({
        ...raw,
        _id: new ObjectId(id || undefined),
        links: { ...raw.links, related: (raw.links?.related ?? []).map((ref) => new ObjectId(ref)) }
      });
      const writeOptions = { signal: abort?.signal, ignoreUndefined: true };

      if (id) {
        const result = await state.collection.replaceOne(guard(doc._id, expected), doc, {
          ...writeOptions,
          upsert: false
        });

        if (!result.acknowledged) {
          throw new StorageWriteError('mongodb replacement was not acknowledged');
        }

        if (result.matchedCount === 0) {
          throw await mismatch(state.collection, doc._id, expected, abort?.signal);
        }
      } else {
        const result = await state.collection.insertOne(doc, writeOptions);

        if (!result.acknowledged) {
          throw new StorageWriteError('mongodb insertion was not acknowledged');
        }

        doc._id = result.insertedId;
      }

      return hydrateRaw(doc);
    } catch (error) {
      throw classify(error, 'save', signal, StorageWriteError, abort);
    }
  }
};
