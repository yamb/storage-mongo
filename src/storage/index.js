import { z } from 'zod';

import { MongoConfigError } from '../errors/index.js';
import { ConfigSchema } from '../schemas/zod.js';
import { setState } from './internal.js';
import methods from './methods.js';

export class MongoStorage {
  constructor(config) {
    const result = ConfigSchema.safeParse(config);

    if (!result.success) {
      throw new MongoConfigError(`invalid config: ${z.prettifyError(result.error)}`, {
        details: { issues: result.error.issues }
      });
    }

    setState(this, {
      config: result.data,
      client: null,
      collection: null,
      opening: null,
      closing: null,
      optionDefaults: {}
    });
  }

  static {
    for (const method of methods) {
      Object.defineProperty(this.prototype, method.name, {
        value(...args) {
          return method.fn(this, ...args);
        },
        writable: false,
        configurable: false,
        enumerable: false
      });
    }
  }
}

export function mongodb(config) {
  return new MongoStorage(config);
}
