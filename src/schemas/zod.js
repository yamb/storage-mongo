import { MongoClient } from 'mongodb';
import { z } from 'zod';

const common = {
  db: z.string().min(1),
  collection: z.string().min(1).default('posts')
};

export const ConfigSchema = z.union([
  z.strictObject({ ...common, client: z.instanceof(MongoClient) }),
  z.strictObject({ ...common, uri: z.string().min(1) })
]);
