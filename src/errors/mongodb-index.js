import { YambError } from '#core/errors';

export class MongoIndexError extends YambError {
  static code = 'YAMB_MONGODB_INDEX';
}
