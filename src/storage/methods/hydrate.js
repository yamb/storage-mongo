import { StorageReadError } from '#core/errors';

export function hydrateRaw(doc) {
  if (!doc) {
    return null;
  }

  const { _id, ...rest } = doc;
  const id = String(_id);
  const related = rest.links?.related;

  if (related !== undefined && !Array.isArray(related)) {
    throw new StorageReadError('corrupt stored post: links.related is not an array', {
      details: { id, source: 'mongodb' }
    });
  }

  return { ...rest, id, links: { ...rest.links, related: related?.map(String) } };
}
