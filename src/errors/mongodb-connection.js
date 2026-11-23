import { YambError } from '#core/errors';

export class MongoConnectionError extends YambError {
  static code = 'YAMB_MONGODB_CONNECTION';
}
