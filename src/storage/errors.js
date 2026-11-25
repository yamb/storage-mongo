import { StorageDuplicateError, YambError } from '#core/errors';

import { MongoConnectionError } from '../errors/index.js';

export function classify(error, method, ErrorClass, abort) {
  if (abort?.cancelled(error)) {
    return abort.reason;
  }

  if (error instanceof YambError) {
    return error;
  }

  if (error?.code === 11000) {
    return new StorageDuplicateError('mongodb duplicate key', { cause: error });
  }

  if (error?.name === 'MongoServerSelectionError') {
    return new MongoConnectionError('mongodb connection failed', { cause: error });
  }

  return new ErrorClass(`mongodb ${method} failed`, { cause: error });
}
