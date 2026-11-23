import { ObjectId } from 'mongodb';

function unicode(value) {
  if (!value.isWellFormed()) {
    throw new Error('mongodb strings and keys require paired Unicode surrogates');
  }

  return Buffer.byteLength(value);
}

export function capture(input) {
  const ancestors = new WeakSet();
  let bytes = 0;

  // This bound must not exceed the encoded BSON size.
  function charge(size) {
    bytes += size;

    if (bytes > 16 * 1024 * 1024) {
      throw new Error('mongodb document exceeds the BSON byte limit');
    }
  }

  function copy(value, depth) {
    if (typeof value === 'string') {
      charge(5 + unicode(value));
      return value;
    }

    if (value === null) {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      charge(typeof value === 'number' ? 4 : 1);
      return value;
    }

    if (value instanceof ObjectId) {
      charge(12);
      return value;
    }

    if (value instanceof Date) {
      charge(8);
      return new Date(value.getTime());
    }

    if (typeof value !== 'object') {
      throw new Error('mongodb document requires data values');
    }

    if (ancestors.has(value)) {
      throw new Error('mongodb document must not contain cycles');
    }

    if (depth > 100) {
      throw new Error('mongodb document exceeds the BSON nesting limit');
    }

    charge(5);
    ancestors.add(value);
    const result = Array.isArray(value) ? [] : {};

    for (const key in value) {
      if (!Object.hasOwn(value, key)) {
        continue;
      }

      const item = value[key];

      if (item === undefined) {
        continue;
      }

      charge(2 + unicode(key));
      Object.defineProperty(result, key, {
        value: copy(item, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }

    ancestors.delete(value);

    return result;
  }

  return copy(input, 0);
}
