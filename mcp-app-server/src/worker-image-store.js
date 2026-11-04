export function createWorkerImageStore(env, sessionId)
{
  function stub()
  {
    return env.MCP_SESSION_MANAGER.get(env.MCP_SESSION_MANAGER.idFromName("diagram-images"));
  }

  return {
    reserve: async function(id)
    {
      try { return await stub().reserveImage(id, sessionId) === true; }
      catch (e) { return false; }
    },
    has: async function(id)
    {
      try { return await stub().hasImage(id) === true; }
      catch (e) { return false; }
    },
    set: async function(id, data)
    {
      try { return await stub().setImage(id, data) === true; }
      catch (e) { return false; }
    },
    get: async function(id)
    {
      try { return await stub().getImage(id); }
      catch (e) { return null; }
    },
  };
}
