import { PostConflictError, PostNotFoundError, StorageWriteError } from '#core/errors';

export function guard(_id, expected) {
  if (expected === undefined) {
    return { _id };
  }

  if (expected !== null && typeof expected !== 'string') {
    throw new StorageWriteError('expected version must be a string or null');
  }

  return { _id, version: expected };
}

export async function mismatch(collection, _id, expected, signal) {
  const id = _id.toString();

  if (expected !== undefined) {
    const current = await collection.findOne({ _id }, { projection: { _id: 1 }, signal });

    if (current) {
      return new PostConflictError(`id "${id}" has another version`, {
        details: { id, expected }
      });
    }
  }

  return new PostNotFoundError(`id "${id}" not found`);
}
