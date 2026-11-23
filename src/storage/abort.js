import { addAbortListener } from 'node:events';

export function driverAbort(signal) {
  const controller = new AbortController();
  const reason = new Error('mongodb operation cancelled');
  const listener = addAbortListener(signal, () => controller.abort(reason));

  if (signal.aborted) {
    controller.abort(reason);
  }

  return {
    signal: controller.signal,
    restore(error) {
      return error === reason ? signal.reason : error;
    },
    [Symbol.dispose]() {
      listener[Symbol.dispose]();
    }
  };
}
