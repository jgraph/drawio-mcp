import { test } from "node:test";
import assert from "node:assert/strict";
import { createImageStore } from "../src/image-store.js";

test("images are isolated, expire, and cannot grow the store without bound", async function()
{
  let now = 0;
  const first = createImageStore({ now: function() { return now; }, ttl: 100, limit: 2 });
  const second = createImageStore({ now: function() { return now; }, ttl: 100, limit: 2 });
  assert.equal(await first.set("a", "unreserved"), false);
  await first.reserve("a");
  await first.set("a", "first");
  assert.equal(await second.get("a"), null);
  await first.reserve("b");
  await first.set("b", "second");
  await first.reserve("c");
  await first.set("c", "third");
  assert.equal(await first.get("a"), null);
  assert.equal(await first.get("c"), "third");
  now = 101;
  assert.equal(await first.get("c"), null);
  assert.equal(await first.set("c", "expired"), false);
});
