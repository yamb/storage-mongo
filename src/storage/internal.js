import { ObjectId } from 'mongodb';

import { StorageNotOpenError } from '#core/errors';
import { store } from '#core/internal';

export const { get: getState, set: setState } = store('MongoStorage');

const hex = /^[0-9a-f]{24}$/;

export function ready(state) {
  if (!state.collection) {
    throw new StorageNotOpenError();
  }

  return state.collection;
}

export function objectId(id) {
  return typeof id === 'string' && hex.test(id) ? ObjectId.createFromHexString(id) : null;
}
