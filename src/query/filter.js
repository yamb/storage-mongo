import { QueryValidationError } from '#core/errors';
import { encodeInstant, InstantSchema, OptionFilterSchema, TagsSchema } from '#core/schemas';

const fields = new Set(['status', 'tags', 'uri', 'before', 'after', 'options', 'cursor']);

function invalid(field, message) {
  return new QueryValidationError(`query.${field} ${message}`, { details: { field } });
}

function text(field, value) {
  if (typeof value !== 'string' || value === '') {
    throw invalid(field, 'must be a nonempty string');
  }

  return value;
}

function instant(field, value) {
  const result = InstantSchema.safeParse(value);

  if (!result.success) {
    throw invalid(field, 'must be an instant');
  }

  return encodeInstant(result.data);
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
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && !fields.has(key)) {
      throw invalid(key, 'is not supported');
    }
  }

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
    filter.status = text('status', query.status);
  }

  if (query.tags !== undefined) {
    const result = TagsSchema.safeParse(query.tags);

    if (!result.success) {
      throw invalid('tags', 'must be an array of up to 50 strings of 1 to 64 UTF-16 units');
    }

    if (result.data.length > 0) {
      filter.tags = { $all: result.data };
    }
  }

  if (query.uri !== undefined) {
    filter.uri = text('uri', query.uri);
  }

  if (query.before !== undefined || query.after !== undefined) {
    filter.publishedAt = {};

    if (query.before !== undefined) {
      filter.publishedAt.$lt = instant('before', query.before);
    }

    if (query.after !== undefined) {
      filter.publishedAt.$gt = instant('after', query.after);
    }
  }

  if (query.cursor !== undefined) {
    const { cursor } = query;

    if (cursor === null || typeof cursor !== 'object') {
      throw invalid('cursor', 'must be an object with publishedAt and uri');
    }

    const operator = descending ? '$lt' : '$gt';
    const date = instant('cursor.publishedAt', cursor.publishedAt);
    const uri = text('cursor.uri', cursor.uri);

    filter.$or = [
      { publishedAt: { [operator]: date } },
      { publishedAt: date, uri: { [operator]: uri } }
    ];
  }

  return filter;
}
