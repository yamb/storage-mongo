import { addAbortListener } from 'node:events';

export async function* iterateCursor(create, signal) {
  signal?.throwIfAborted();

  let cursor;
  let closing;
  let failed = false;

  // Register before the driver because a second close() cannot await its abort-triggered close.
  const listener =
    signal &&
    addAbortListener(signal, async () => {
      closing = cursor?.close();

      try {
        await closing;
      } catch {
        // The owning finally awaits the same promise.
      }
    });

  try {
    cursor = create();

    for await (const doc of cursor) {
      signal?.throwIfAborted();
      yield doc;
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await (closing ?? cursor?.close());
    } catch (error) {
      if (!failed) {
        // oxlint-disable-next-line no-unsafe-finally
        throw error;
      }
    } finally {
      listener?.[Symbol.dispose]();
    }
  }
}
