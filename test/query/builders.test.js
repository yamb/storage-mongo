import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMongoFilter } from '../../src/query/filter.js';
import { buildMongoSort } from '../../src/query/sort.js';
import { hydrateRaw } from '../../src/storage/methods/hydrate.js';

test('empty filter returns {}', () => {
  assert.deepEqual(buildMongoFilter({}), {});
});

test('status filter', () => {
  assert.deepEqual(buildMongoFilter({ status: 'published' }), {
    status: 'published'
  });
});

test('tags array filter ($all)', () => {
  assert.deepEqual(buildMongoFilter({ tags: ['js', 'node'] }), {
    tags: { $all: ['js', 'node'] }
  });
});

test('unknown query keys are rejected and undefined ones are ignored', () => {
  assert.throws(() => buildMongoFilter({ tag: 'js' }), { code: 'YAMB_QUERY_VALIDATION' });
  assert.deepEqual(buildMongoFilter({ tag: undefined, tags: ['js'] }), {
    tags: { $all: ['js'] }
  });
});

test('before/after Instant → fixed-precision ISO string', () => {
  const before = Temporal.Instant.from('2026-05-01T00:00:00Z');
  const result = buildMongoFilter({ before });
  assert.deepEqual(result, { publishedAt: { $lt: '2026-05-01T00:00:00.000000000Z' } });
});

test('ISO string bounds are normalized to fixed-precision UTC', () => {
  assert.deepEqual(
    buildMongoFilter({ before: '2026-05-01T03:00:00+03:00', after: '2026-04-01T00:00:00.5Z' }),
    {
      publishedAt: {
        $lt: '2026-05-01T00:00:00.000000000Z',
        $gt: '2026-04-01T00:00:00.500000000Z'
      }
    }
  );
  assert.throws(() => buildMongoFilter({ before: 'yesterday' }), {
    code: 'YAMB_QUERY_VALIDATION'
  });
});

test('cursor + ascending (desc=false) → $gt keyset, sort uri asc', () => {
  const publishedAt = Temporal.Instant.from('2026-04-26T10:00:00Z');
  assert.deepEqual(buildMongoFilter({ cursor: { publishedAt, uri: '2026/04/bbb' } }, false), {
    $or: [
      { publishedAt: { $gt: '2026-04-26T10:00:00.000000000Z' } },
      { publishedAt: '2026-04-26T10:00:00.000000000Z', uri: { $gt: '2026/04/bbb' } }
    ]
  });
  assert.deepEqual(buildMongoSort('publishedAt'), { publishedAt: 1, uri: 1 });
});

test('cursor + descending (desc=true) → $lt keyset, sort uri desc', () => {
  const publishedAt = Temporal.Instant.from('2026-04-26T10:00:00Z');
  assert.deepEqual(buildMongoFilter({ cursor: { publishedAt, uri: '2026/04/bbb' } }, true), {
    $or: [
      { publishedAt: { $lt: '2026-04-26T10:00:00.000000000Z' } },
      { publishedAt: '2026-04-26T10:00:00.000000000Z', uri: { $lt: '2026/04/bbb' } }
    ]
  });
  assert.deepEqual(buildMongoSort('-publishedAt'), { publishedAt: -1, uri: -1 });
});

test('uri filter exact', () => {
  assert.deepEqual(buildMongoFilter({ uri: '2026/04/x' }), {
    uri: '2026/04/x'
  });
});

test('option filters are native field predicates that exclude arrays', () => {
  assert.deepEqual(
    buildMongoFilter(
      { options: { homepage: true, feeds: false, card: null, type: 'note', tid: 1 } },
      true,
      { homepage: true, feeds: true, card: null, type: 'article' }
    ),
    {
      options: { $not: { $type: 'array' } },
      'options.homepage': { $in: [true, null], $not: { $type: ['null', 'array'] } },
      'options.feeds': { $eq: false, $not: { $type: 'array' } },
      'options.card': { $eq: null, $not: { $type: 'array' } },
      'options.type': { $eq: 'note', $not: { $type: 'array' } },
      'options.tid': { $eq: 1, $not: { $type: 'array' } }
    }
  );
  assert.deepEqual(buildMongoFilter({ options: { card: null } }), {
    options: { $not: { $type: 'array' } },
    'options.card': { $type: 'null', $not: { $type: 'array' } }
  });
  assert.deepEqual(buildMongoFilter({ options: {} }), {});
});

test('rejects operator-object in status field', () => {
  assert.throws(() => buildMongoFilter({ status: { $ne: null } }), {
    code: 'YAMB_QUERY_VALIDATION'
  });
});

test('rejects operator-object inside tags array', () => {
  assert.throws(() => buildMongoFilter({ tags: ['ok', { $ne: null }] }), {
    code: 'YAMB_QUERY_VALIDATION'
  });
});

test('rejects operator-object in uri field', () => {
  assert.throws(() => buildMongoFilter({ uri: { $gt: '' } }), {
    code: 'YAMB_QUERY_VALIDATION'
  });
});

test('rejects operator-object in before/after', () => {
  assert.throws(() => buildMongoFilter({ before: { $gt: '' } }), {
    code: 'YAMB_QUERY_VALIDATION'
  });
  assert.throws(() => buildMongoFilter({ after: { $ne: null } }), {
    code: 'YAMB_QUERY_VALIDATION'
  });
});

test('rejects operator-object in cursor.publishedAt (injection via $or value)', () => {
  assert.throws(
    () => buildMongoFilter({ cursor: { publishedAt: { $gt: '' }, uri: '2026/04/x' } }),
    { code: 'YAMB_QUERY_VALIDATION' }
  );
});

test('rejects operator-object in cursor.uri', () => {
  const publishedAt = Temporal.Instant.from('2026-04-26T10:00:00Z');
  assert.throws(() => buildMongoFilter({ cursor: { publishedAt, uri: { $gt: '' } } }), {
    code: 'YAMB_QUERY_VALIDATION'
  });
});

test('accepts Instant/string in cursor (not rejected as operator)', () => {
  const publishedAt = Temporal.Instant.from('2026-04-26T10:00:00Z');
  assert.deepEqual(buildMongoFilter({ cursor: { publishedAt, uri: '2026/04/bbb' } }, false), {
    $or: [
      { publishedAt: { $gt: '2026-04-26T10:00:00.000000000Z' } },
      { publishedAt: '2026-04-26T10:00:00.000000000Z', uri: { $gt: '2026/04/bbb' } }
    ]
  });
});

test('combined filters', () => {
  const before = Temporal.Instant.from('2026-05-01T00:00:00Z');

  assert.deepEqual(buildMongoFilter({ status: 'published', tags: ['js'], before }), {
    status: 'published',
    tags: { $all: ['js'] },
    publishedAt: { $lt: '2026-05-01T00:00:00.000000000Z' }
  });
});

test('default sort is publishedAt desc with matching-direction uri tiebreaker', () => {
  assert.deepEqual(buildMongoSort(undefined), { publishedAt: -1, uri: -1 });
  assert.deepEqual(buildMongoSort('-publishedAt'), { publishedAt: -1, uri: -1 });
});

test('publishedAt asc', () => {
  assert.deepEqual(buildMongoSort('publishedAt'), { publishedAt: 1, uri: 1 });
});

test('createdAt desc', () => {
  assert.deepEqual(buildMongoSort('-createdAt'), { createdAt: -1, uri: -1 });
});

test('title asc', () => {
  assert.deepEqual(buildMongoSort('title'), { title: 1, uri: 1 });
});

test('buildMongoSort rejects an invalid / $-prefixed order', () => {
  assert.throws(() => buildMongoSort('$natural'), { code: 'YAMB_QUERY_VALIDATION' });
  assert.throws(() => buildMongoSort('publishedAt;DROP'), { code: 'YAMB_QUERY_VALIDATION' });
  assert.doesNotThrow(() => buildMongoSort('title'));
});

test('buildMongoFilter rejects a malformed cursor shape', () => {
  assert.throws(() => buildMongoFilter({ cursor: ['bad'] }, false), {
    code: 'YAMB_QUERY_VALIDATION'
  });
  assert.throws(() => buildMongoFilter({ cursor: { publishedAt: null, uri: 'x' } }, false), {
    code: 'YAMB_QUERY_VALIDATION'
  });
});

test('hydrateRaw rejects a non-array links.related', () => {
  assert.throws(
    () => hydrateRaw({ _id: 'abc', uri: '2026/04/x', links: { related: 'not-an-array' } }),
    { code: 'YAMB_STORAGE_READ' }
  );
  assert.doesNotThrow(() => hydrateRaw({ _id: 'abc', uri: '2026/04/x', links: { related: [] } }));
});
