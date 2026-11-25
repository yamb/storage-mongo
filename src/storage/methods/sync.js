import { getState, ready } from '../internal.js';

export default {
  name: 'sync',

  async fn(storage, options = {}) {
    ready(getState(storage));
    options.signal?.throwIfAborted();
  }
};
