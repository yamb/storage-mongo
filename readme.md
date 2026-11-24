# yamb-storage-mongo

[![npm version][npm-image]][npm-url] [![Build status][github-actions-image]][github-actions-url] [![Coverage status][coveralls-image]][coveralls-url] [![Dependency status][libraries-image]][libraries-url]

Store [Yamb](https://github.com/yamb/yamb) posts in MongoDB using the official driver and server-side queries.

For GitHub Packages, route the `@yamb` scope to `https://npm.pkg.github.com` and install `@yamb/storage-mongo`.

## Quick start

Requires Node.js 26.13 or later, `yamb` and an existing MongoDB 9 database with a `posts` collection and the [required indexes](#configuration-and-indexes).

```bash
pnpm add yamb yamb-storage-mongo
```

Set `MONGO_URI` to the connection URI and `YAMB_MONGO_DB` to the prepared database name.

```js
import { yamb } from 'yamb';
import { mongodb } from 'yamb-storage-mongo';

await using blog = yamb({
  storage: mongodb({
    uri: process.env.MONGO_URI,
    db: process.env.YAMB_MONGO_DB
  })
});

await blog.open();

const post = await blog.create({
  title: 'Hello',
  text: '**Hello**, MongoDB.',
  status: 'published'
});

const saved = await blog.find(post.id);

console.log(saved.text);
```

## Reference

### Configuration and indexes

`mongodb(config)` and `new MongoStorage(config)` require exactly one of `uri` or `client`. Unknown keys are rejected.

| Key | Meaning | Default |
| --- | --- | --- |
| `uri` | Connection URI for an adapter-owned client | Required unless `client` is supplied |
| `client` | Application-owned official `MongoClient` | Required unless `uri` is supplied |
| `db` | Existing database name, including with an external client | Required |
| `collection` | Existing collection name | `'posts'` |

`open()` checks the existing collection and indexes with read-only commands. Key order and direction must match. Index names are unrestricted.

| Keys                                      | Constraint |
| ----------------------------------------- | ---------- |
| `{ uri: 1 }`                              | Unique     |
| `{ status: 1, publishedAt: -1, uri: -1 }` |            |
| `{ publishedAt: -1 }`                     |            |
| `{ createdAt: -1 }`                       |            |
| `{ updatedAt: -1 }`                       |            |
| `{ status: 1, title: 1, uri: 1 }`         |            |
| `{ status: 1, createdAt: -1, uri: -1 }`   |            |
| `{ status: 1, updatedAt: -1, uri: -1 }`   |            |
| `{ tags: 1 }`                             |            |
| `{ 'links.related': 1 }`                  |            |

The check requires full, visible indexes without a collation entry. A missing collection or index fails with `YAMB_MONGODB_INDEX`.

### BSON and writes

`id` maps to MongoDB `_id`. Both `_id` and `links.related` use BSON `ObjectId` values in MongoDB and strings at the adapter boundary. The adapter stores source data and fixed-precision UTC date strings, omitting `undefined` fields.

Save captures input before driver I/O. It rejects cycles, unsupported values, unpaired surrogates in strings or keys, nesting deeper than 100 and a BSON size lower bound above 16 MiB. The driver checks the exact BSON size.

Updates replace the complete document. A missing update target fails, and the unique index enforces URI collisions. Inserts, updates and removals require driver acknowledgment. Independently loaded posts use whole-document last-write semantics.

MongoDB executes queries with typed option comparisons. Missing option fields match defaults supplied by core on open. Arrays never match a scalar option filter. Each option filter is a field predicate on `options.<name>`, so an application index such as `{ status: 1, 'options.homepage': 1, publishedAt: -1, uri: -1 }` can serve it. `find(id)` looks up a post by ID and `fetch(uri)` looks it up by current URI. Core refreshes its lookup maps from the `[id, uri]` pairs yielded by `entries()`.

### Ownership and lifecycle

An adapter-owned client disables driver write retries and closes on shutdown or failed open. Concurrent opens share the first caller’s acquisition context. Close waits for acquisition, and reopen waits for close.

For an application-owned client, add `mongodb` as a direct dependency and close the client after adapter use.

```js
import { MongoClient } from 'mongodb';
import { mongodb } from 'yamb-storage-mongo';

const client = new MongoClient('mongodb://127.0.0.1:27017', {
  retryWrites: false
});

const storage = mongodb({
  client,
  db: 'blog',
  collection: 'posts'
});

try {
  await storage.open();

  console.log(await storage.count());
} finally {
  await storage.close();
  await client.close();
}
```

The application owns a supplied client’s connections and retry policy. Verify a failed write’s outcome before retrying. Late cancellation preserves acknowledged writes, and aborted operations preserve the native reason.

Each traversal owns a lazy cursor. Early exit or cancellation awaits cleanup and preserves any prior iteration failure. Traversals can observe concurrent writes.

### Errors

| Code | Meaning |
| --- | --- |
| `YAMB_MONGODB_CONFIG` | Invalid configuration (`MongoConfigError`) |
| `YAMB_MONGODB_CONNECTION` | Open or server-selection failure (`MongoConnectionError`) |
| `YAMB_MONGODB_INDEX` | Missing prepared collection/index (`MongoIndexError`) |
| `YAMB_STORAGE_READ`, `YAMB_STORAGE_WRITE` | Read/write, BSON or cursor cleanup failure; cause retained |
| `YAMB_STORAGE_DUPLICATE` | Duplicate key |
| `YAMB_POST_NOT_FOUND` | Missing update/removal target; missing reads return `null` |
| `YAMB_STORAGE_NOT_OPEN` | Operation outside an open lifetime |
| `YAMB_QUERY_VALIDATION` | Invalid query or pagination |

Shared errors come from `yamb/errors`. Adapter-specific classes are internal; inspect their stable codes.

## Author

[Alexey Simonenko](https://simonenko.xyz)

## License

MIT. See `LICENSE`.

[npm-image]: https://img.shields.io/npm/v/yamb-storage-mongo?style=flat
[npm-url]: https://www.npmjs.com/package/yamb-storage-mongo
[github-actions-image]: https://github.com/yamb/storage-mongo/actions/workflows/ci.yml/badge.svg
[github-actions-url]: https://github.com/yamb/storage-mongo/actions/workflows/ci.yml
[coveralls-image]: https://coveralls.io/repos/github/yamb/storage-mongo/badge.svg
[coveralls-url]: https://coveralls.io/github/yamb/storage-mongo
[libraries-image]: https://img.shields.io/librariesio/release/npm/yamb-storage-mongo?style=flat
[libraries-url]: https://libraries.io/npm/yamb-storage-mongo
