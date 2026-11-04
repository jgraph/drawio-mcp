// Images stay in memory and expire even if no later request reads them.
export function createImageStore({ now = Date.now, ttl = 300000, limit = 64, perSessionLimit = 8 } = {})
{
  const images = new Map();
  const sessionCounts = new Map();

  function remove(id)
  {
    const entry = images.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    images.delete(id);

    if (entry.sessionId != null)
    {
      const count = sessionCounts.get(entry.sessionId) || 0;
      if (count <= 1) sessionCounts.delete(entry.sessionId);
      else sessionCounts.set(entry.sessionId, count - 1);
    }
  }

  function removeOldestFromSession(sessionId)
  {
    for (const [id, entry] of images)
    {
      if (entry.sessionId === sessionId)
      {
        remove(id);
        return true;
      }
    }
    return false;
  }

  return {
    async reserve(id, sessionId = null)
    {
      remove(id);

      if (sessionId != null && perSessionLimit > 0)
      {
        while ((sessionCounts.get(sessionId) || 0) >= perSessionLimit)
        {
          removeOldestFromSession(sessionId);
        }
      }

      while (images.size >= limit)
      {
        const oldest = images.keys().next().value;
        remove(oldest);
      }

      const entry = { data: null, expires: now() + ttl, sessionId: sessionId };
      entry.timer = setTimeout(function()
      {
        if (images.get(id) === entry) remove(id);
      }, ttl);
      if (typeof entry.timer.unref === "function") entry.timer.unref();
      images.set(id, entry);
      if (sessionId != null) sessionCounts.set(sessionId, (sessionCounts.get(sessionId) || 0) + 1);
      return true;
    },
    async has(id)
    {
      const entry = images.get(id);
      if (!entry) return false;
      if (entry.expires <= now())
      {
        remove(id);
        return false;
      }
      return true;
    },
    async set(id, data)
    {
      const entry = images.get(id);
      if (!entry || entry.expires <= now())
      {
        remove(id);
        return false;
      }
      entry.data = data;
      return true;
    },
    async get(id)
    {
      const entry = images.get(id);
      if (!entry) return null;
      if (entry.expires <= now())
      {
        remove(id);
        return null;
      }
      return entry.data;
    },
  };
}
