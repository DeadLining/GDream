import { stripObsoleteSettings } from './obsoleteSettings.ts';
/** Disk is authoritative across dev/prod WebView origins. Cache is only a
 * migration fallback when the file does not exist, never on read/parse errors. */
export function createSettingsStorage(io: {
  cache: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  readFile: () => Promise<string | null>;
  /** Must atomically compare expected contents and replace with owner-only permissions. */
  writeFile: (value: string, expected: string | null) => Promise<void>;
  onError: (phase: 'load' | 'save' | 'not-ready') => void;
}) {
  let ready = false;
  let expected: string | null = null;
  let queue: Promise<void> = Promise.resolve();
  const validate = (value: string) => {
    try {
      const data = JSON.parse(value);
      if (!data || typeof data !== 'object' || Array.isArray(data)
        || !data.state || typeof data.state !== 'object' || Array.isArray(data.state)
        || (data.version !== undefined && (!Number.isInteger(data.version) || data.version < 0))) {
        throw new Error();
      }
    } catch { throw new Error('设置文件格式无效，已阻止覆盖。'); }
  };
  const sanitize = (value: string) => {
    validate(value);
    const parsed = JSON.parse(value);
    const clean = stripObsoleteSettings(parsed.state);
    return Object.keys(clean).length === Object.keys(parsed.state).length
      ? value : JSON.stringify({ ...parsed, state: clean });
  };
  const cacheValue = (name: string, value: string) => {
    try { io.cache.setItem(name, value); } catch { /* Disk remains authoritative even at cache quota. */ }
  };
  return {
    async getItem(name: string): Promise<string | null> {
      await queue;
      ready = false;
      try {
        const disk = await io.readFile();
        let value = disk ?? io.cache.getItem(name);
        if (value !== null) validate(value);
        expected = disk;
        if (value !== null) {
          const clean = sanitize(value);
          if (clean !== value) {
            await io.writeFile(clean, expected);
            expected = clean;
            value = clean;
          }
        }
        if (value !== null) cacheValue(name, value);
        ready = true;
        return value;
      } catch {
        io.onError('load');
        throw new Error('无法安全加载设置，已阻止覆盖现有配置。');
      }
    },
    setItem(name: string, value: string): Promise<void> {
      // App and private defaults must not mount until hydration has completed.
      // Fail closed for accidental setters during module initialization as well.
      if (!ready) { io.onError('not-ready'); return Promise.resolve(); }
      queue = queue.then(async () => {
        if (!ready) return;
        value = sanitize(value);
        await io.writeFile(value, expected);
        expected = value;
        cacheValue(name, value);
      }).catch(() => {
        ready = false;
        // Never expose filesystem errors or serialized credential values in UI/logs.
        io.onError('save');
      });
      return queue;
    },
    flush: () => queue,
    removeItem(name: string) {
      // clearStorage is cache-only; deleting credentials is an explicit store edit.
      io.cache.removeItem(name);
    },
  };
}
