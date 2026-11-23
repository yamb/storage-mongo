import assert from 'node:assert/strict';
import test from 'node:test';

import { setState } from '../../../src/storage/internal.js';
import remove from '../../../src/storage/methods/remove.js';
import { blogWith, postData } from '../../fixture.js';

test('an unacknowledged Mongo removal leaves the live Post confirmed and editable', async (t) => {
  const id = '507f1f77bcf86cd799439011';
  const uri = '2026/11/article-0';
  const blog = await blogWith([{ ...postData(), id, uri }]);
  t.after(() => blog.close());

  const adapter = {};
  setState(adapter, {
    collection: {
      async deleteOne() {
        return { acknowledged: false };
      }
    }
  });
  blog.storage.remove = (...args) => remove.fn(adapter, ...args);

  const post = await blog.find(id);
  await assert.rejects(() => post.remove(), { code: 'YAMB_STORAGE_WRITE' });
  assert.equal(blog.locate(id), uri);
  assert.equal(blog.identify(uri), id);
  assert.deepEqual(post.changes(), {});

  post.title = 'Still live after an unconfirmed deletion';
  await post.save();
  const reloaded = await blog.find(id);
  assert.equal(reloaded.title, 'Still live after an unconfirmed deletion');
});
