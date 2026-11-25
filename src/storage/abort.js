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
    get reason() {
      return signal.reason;
    },
    cancelled(error) {
      return error === reason || (signal.aborted && Object.is(error, signal.reason));
    },
    [Symbol.dispose]() {
      listener[Symbol.dispose]();
    }
  };
}
