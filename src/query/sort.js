import { orderValues } from '#core/constants';
import { QueryValidationError } from '#core/errors';

export function buildMongoSort(order = '-publishedAt') {
  if (!orderValues.includes(order)) {
    throw new QueryValidationError(`invalid order "${order}"`, {
      details: { field: 'order', allowed: orderValues }
    });
  }

  const descending = order.startsWith('-');
  const field = descending ? order.slice(1) : order;
  const direction = descending ? -1 : 1;

  return { [field]: direction, uri: direction };
}
