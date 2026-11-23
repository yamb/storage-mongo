import { getState } from '../internal.js';

async function release(state) {
  if (state.opening) {
    try {
      await state.opening;
    } catch {
      return;
    }
  }

  const { client } = state;
  state.client = null;
  state.collection = null;
  state.optionDefaults = {};

  if (client && !state.config.client) {
    await client.close();
  }
}

export default {
  name: 'close',

  async fn(storage) {
    const state = getState(storage);

    if (state.closing) {
      return state.closing;
    }

    if (!state.collection && !state.opening) {
      return;
    }

    state.closing = release(state);

    try {
      await state.closing;
    } finally {
      state.closing = null;
    }
  }
};
