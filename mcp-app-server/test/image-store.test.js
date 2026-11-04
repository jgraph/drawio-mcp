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
  assert.equal(await first.has("a"), true);
  await first.set("a", "first");
  assert.equal(await second.get("a"), null);
  await first.reserve("b");
  await first.set("b", "second");
  await first.reserve("c");
  await first.set("c", "third");
  assert.equal(await first.get("a"), null);
  assert.equal(await first.get("c"), "third");
  now = 101;
  assert.equal(await first.has("c"), false);
  assert.equal(await first.get("c"), null);
  assert.equal(await first.set("c", "expired"), false);
});

test("a session quota keeps its reservations from evicting another session", async function()
{
  const images = createImageStore({ ttl: 1000, limit: 3, perSessionLimit: 2 });

  await images.reserve("b1", "session-b");
  await images.set("b1", "image-b");
  await images.reserve("a1", "session-a");
  await images.set("a1", "image-a1");
  await images.reserve("a2", "session-a");
  await images.set("a2", "image-a2");
  await images.reserve("a3", "session-a");
  await images.set("a3", "image-a3");

  assert.equal(await images.get("b1"), "image-b");
  assert.equal(await images.get("a1"), null);
  assert.equal(await images.get("a2"), "image-a2");
  assert.equal(await images.get("a3"), "image-a3");
});
