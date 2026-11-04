// Images stay in memory and expire even if no later request reads them.
export function createImageStore({ now = Date.now, ttl = 300000, limit = 8 } = {})
{
  const images = new Map();

  return {
    async reserve(id)
    {
      const previous = images.get(id);
      if (previous) clearTimeout(previous.timer);
      images.delete(id);

      while (images.size >= limit)
      {
        const oldest = images.keys().next().value;
        clearTimeout(images.get(oldest).timer);
        images.delete(oldest);
      }

      const entry = { data: null, expires: now() + ttl };
      entry.timer = setTimeout(function()
      {
        if (images.get(id) === entry) images.delete(id);
      }, ttl);
      if (typeof entry.timer.unref === "function") entry.timer.unref();
      images.set(id, entry);
    },
    async set(id, data)
    {
      const entry = images.get(id);
      if (!entry || entry.expires <= now()) return false;
      entry.data = data;
      return true;
    },
    async get(id)
    {
      const entry = images.get(id);
      if (!entry) return null;
      if (entry.expires <= now())
      {
        clearTimeout(entry.timer);
        images.delete(id);
        return null;
      }
      return entry.data;
    },
  };
}
