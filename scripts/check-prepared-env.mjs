import { mongodb } from 'yamb-storage-mongo';

const uri = process.env.MONGO_URI;
const db = process.env.YAMB_MONGO_DB;

if (!uri || !db?.startsWith('yamb_test_')) {
  throw new Error(
    'MONGO_URI and YAMB_MONGO_DB must name an existing prepared yamb_test_* database'
  );
}

const storage = mongodb({ uri, db });

try {
  await storage.open();
  const count = await storage.count({});

  if (count !== 0) {
    throw new Error('Prepared Mongo posts must be empty before integrations');
  }

  console.log({
    database: 'MongoDB',
    documents: count,
    structure: 'existing posts and required indexes'
  });
} finally {
  await storage.close();
}
