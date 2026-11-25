import { ObjectId } from 'mongodb';

import { LinkRefNotFoundError, PostNotFoundError, StorageWriteError } from '#core/errors';

import { driverAbort } from '../abort.js';
import { capture } from '../capture.js';
import { classify } from '../errors.js';
import { getState, objectId, ready } from '../internal.js';
import { guard, mismatch } from '../version.js';
import { hydrateRaw } from './hydrate.js';

export default {
  name: 'save',

  async fn(storage, input, options = {}) {
    const { signal, expected } = options;
    const collection = ready(getState(storage));
    signal?.throwIfAborted();

    using abort = signal ? driverAbort(signal) : null;

    try {
      const { id, ...raw } = input;
      const _id = id === undefined ? new ObjectId() : objectId(id);

      if (!_id) {
        throw new PostNotFoundError('post id not found');
      }

      const refs = raw.links?.related ?? [];
      const related = refs.map(objectId);

      if (related.includes(null)) {
        throw new LinkRefNotFoundError('unknown link ids', {
          details: { unknownRefs: refs.filter((_, i) => !related[i]) }
        });
      }

      const doc = capture({ ...raw, _id, links: { ...raw.links, related } });
      const writeOptions = { signal: abort?.signal, ignoreUndefined: true };

      if (id === undefined) {
        const result = await collection.insertOne(doc, writeOptions);

        if (!result.acknowledged) {
          throw new StorageWriteError('mongodb insertion was not acknowledged');
        }
      } else {
        const result = await collection.replaceOne(guard(_id, expected), doc, writeOptions);

        if (!result.acknowledged) {
          throw new StorageWriteError('mongodb replacement was not acknowledged');
        }

        if (result.matchedCount === 0) {
          throw await mismatch(collection, _id, expected, abort?.signal);
        }
      }

      return hydrateRaw(doc);
    } catch (error) {
      throw classify(error, 'save', StorageWriteError, abort);
    }
  }
};
