import { QueryValidationError } from '#core/errors';
import { encodeInstant, OptionFilterSchema, TagSchema } from '#core/schemas';

function nonempty(field, value) {
  if (value === '') {
    throw new QueryValidationError(`query.${field} must not be an empty string`, {
      details: { field }
    });
  }
}

function bound(value) {
  if (value instanceof Temporal.Instant) {
    return encodeInstant(value);
  }

  if (value instanceof Date) {
    return encodeInstant(Temporal.Instant.fromEpochMilliseconds(value.getTime()));
  }

  return value;
}

function literal(field, value) {
  if (
    value !== null &&
    typeof value === 'object' &&
    !(value instanceof Date) &&
    !(value instanceof Temporal.Instant)
  ) {
    throw new QueryValidationError(
      `query.${field} must be a primitive (string/number); got an object — operator injection rejected`,
      { details: { field, type: typeof value } }
    );
  }
}

function option(value, defaulted) {
  if (value === null) {
    return defaulted
      ? { $eq: null, $not: { $type: 'array' } }
      : { $type: 'null', $not: { $type: 'array' } };
  }

  return defaulted
    ? { $in: [value, null], $not: { $type: ['null', 'array'] } }
    : { $eq: value, $not: { $type: 'array' } };
}

export function buildMongoFilter(query, descending = true, defaults = {}) {
  const filter = {};

  if (query.options !== undefined) {
    const result = OptionFilterSchema.safeParse(query.options);

    if (!result.success) {
      throw new QueryValidationError(
        'options filter requires supported names and scalar JSON values'
      );
    }

    const entries = Object.entries(result.data);

    if (entries.length > 0) {
      filter.options = { $not: { $type: 'array' } };
    }

    for (const [key, value] of entries) {
      filter[`options.${key}`] = option(
        value,
        Object.hasOwn(defaults, key) && defaults[key] === value
      );
    }
  }

  if (query.status !== undefined) {
    nonempty('status', query.status);
    literal('status', query.status);
    filter.status = query.status;
  }

  if (query.tag !== undefined) {
    if (!TagSchema.safeParse(query.tag).success) {
      throw new QueryValidationError('query.tag must be a string of 1 to 64 UTF-16 units');
    }
  }

  if (query.tags !== undefined) {
    if (!TagSchema.array().safeParse(query.tags).success) {
      throw new QueryValidationError(
        'query.tags must be an array of strings of 1 to 64 UTF-16 units'
      );
    }
  }

  if (query.tags?.length > 0) {
    filter.tags = {
      $all: query.tag !== undefined ? [query.tag, ...query.tags] : [...query.tags]
    };
  } else if (query.tag !== undefined) {
    filter.tags = query.tag;
  }

  if (query.uri !== undefined) {
    nonempty('uri', query.uri);
    literal('uri', query.uri);
    filter.uri = query.uri;
  }

  if (query.before || query.after) {
    filter.publishedAt = {};

    if (query.before) {
      literal('before', query.before);
      filter.publishedAt.$lt = bound(query.before);
    }

    if (query.after) {
      literal('after', query.after);
      filter.publishedAt.$gt = bound(query.after);
    }
  }

  if (query.cursor) {
    if (
      typeof query.cursor !== 'object' ||
      Array.isArray(query.cursor) ||
      query.cursor.publishedAt == null ||
      query.cursor.uri == null
    ) {
      throw new QueryValidationError('query.cursor must be an object with publishedAt and uri', {
        details: { field: 'cursor' }
      });
    }

    const { publishedAt, uri } = query.cursor;
    literal('cursor.publishedAt', publishedAt);
    literal('cursor.uri', uri);

    const operator = descending ? '$lt' : '$gt';
    const date = bound(publishedAt);

    filter.$or = [
      { publishedAt: { [operator]: date } },
      { publishedAt: date, uri: { [operator]: uri } }
    ];
  }

  return filter;
}
