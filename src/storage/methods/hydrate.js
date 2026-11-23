import { StorageReadError } from '#core/errors';

function assertRelated(related, id) {
  if (related !== undefined && !Array.isArray(related)) {
    throw new StorageReadError('corrupt stored post: links.related is not an array', {
      details: { id, source: 'mongodb' }
    });
  }
}

export function hydrateRaw(doc) {
  if (!doc) {
    return null;
  }

  const { _id, ...rest } = doc;
  const id = _id?.toString?.() ?? String(_id);
  const refs = rest.links?.related;

  assertRelated(refs, id);

  const related = refs?.map((ref) => ref?.toString?.() ?? String(ref));

  return {
    ...rest,
    id,
    links: { ...rest.links, related }
  };
}
