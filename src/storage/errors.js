import { StorageDuplicateError, StorageWriteError } from '#core/errors';

import { MongoConnectionError } from '../errors/index.js';

export function classify(cause, method, signal, ErrorClass = StorageWriteError, abort) {
  const error = abort ? abort.restore(cause) : cause;

  if (signal?.aborted && Object.is(error, signal.reason)) {
    return signal.reason;
  }

  if (error?.code?.startsWith?.('YAMB_')) {
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
