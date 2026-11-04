import { test } from "node:test";
import assert from "node:assert/strict";
import { createImageStore } from "../src/image-store.js";
import { createWorkerImageStore } from "../src/worker-image-store.js";

test("worker image IDs are shared across sessions through one bounded object", async function()
{
  const images = createImageStore({ limit: 64, perSessionLimit: 8 });
  const names = [];
  const env =
  {
    MCP_SESSION_MANAGER:
    {
      idFromName: function(name) { names.push(name); return name; },
      get: function(id)
      {
        return {
          reserveImage: function(imageId, owner) { return images.reserve(imageId, owner); },
          hasImage: function(imageId) { return images.has(imageId); },
          setImage: function(imageId, data) { return images.set(imageId, data); },
          getImage: function(imageId) { return images.get(imageId); },
        };
      },
    },
  };
  const firstSession = createWorkerImageStore(env, "session-a");
  const secondSession = createWorkerImageStore(env, "session-b");

  assert.equal(await firstSession.reserve("id-a"), true);
  assert.equal(await firstSession.set("id-a", "png-data"), true);
  assert.equal(await secondSession.has("id-a"), true);
  assert.equal(await secondSession.get("id-a"), "png-data");
  assert.ok(names.length > 0);
  assert.ok(names.every(function(name) { return name === "diagram-images"; }));
});

test("worker image store failures use safe empty results", async function()
{
  const env =
  {
    MCP_SESSION_MANAGER:
    {
      idFromName: function() { throw new Error("unavailable"); },
      get: function() { throw new Error("unavailable"); },
    },
  };
  const images = createWorkerImageStore(env, "session-a");

  assert.equal(await images.reserve("id"), false);
  assert.equal(await images.has("id"), false);
  assert.equal(await images.set("id", "png-data"), false);
  assert.equal(await images.get("id"), null);
});
