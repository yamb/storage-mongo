import { YambError } from '#core/errors';

export class MongoConfigError extends YambError {
  static code = 'YAMB_MONGODB_CONFIG';
}
