/**
 * legacyRename — 一次性把「鲲鹏/Kunpeng」时代的持久化标识迁移到 GDream。
 *
 * 品牌从 Kunpeng 更名为 GDream 时改名了两处**用户数据的落点**：
 *   · 数据目录      ~/.kunpeng                       → ~/.gdream
 *   · localStorage  kunpeng-* / kunpeng.*            → gdream-* / gdream.*
 *
 * 迁移原则：**复制、不移动、不清源**。
 *   1. Rust 侧 migrate_legacy_data_dir() 在 Tauri setup 阶段把 ~/.kunpeng
 *      **补缺式**复制到 ~/.gdream（只补新目录没有的文件，绝不覆盖新数据），
 *      完成后在 ~/.gdream 写标记文件 `.migrated-from-kunpeng`；判定依据是
 *      标记文件而不是「新目录是否存在」，因为新目录会被资源部署提前创建。
 *   2. migrateLocalStorageKeys() 在 WebView 启动最早阶段（legacyRenameBoot）
 *      把旧键的值复制到新键（已存在的新键不覆盖），旧键保留，方便回退旧版本。
 *
 * 两条链路都幂等，失败都不阻断启动，下次启动自动重试。
 */

/** 旧 → 新 前缀（- 用于 zustand persist 键；. 用于手工存的版本化键）。 */
export const LEGACY_KEY_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['kunpeng-', 'gdream-'],
  ['kunpeng.', 'gdream.'],
];

/** 最小存储接口，方便在 Node 下用内存实现做单测。 */
export interface KeyValueStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 把 store 里所有旧前缀的键复制成新前缀的键。
 * 已存在的新键不覆盖（避免冲掉用户在新版里的改动）。
 * 返回实际复制的键数量。
 */
export function migrateKeysInStore(store: KeyValueStore): number {
  const pending: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    for (const [oldP, newP] of LEGACY_KEY_PREFIXES) {
      if (key.startsWith(oldP)) {
        const target = newP + key.slice(oldP.length);
        // 只迁移「新键还不存在」的项，保持新值优先。
        if (store.getItem(target) === null) pending.push([key, target]);
        break;
      }
    }
  }

  let moved = 0;
  for (const [from, to] of pending) {
    const value = store.getItem(from);
    if (value === null) continue;
    try {
      store.setItem(to, value);
      moved += 1;
    } catch {
      // 配额异常不该阻断启动：缺键时业务侧会回退到磁盘文件。
    }
  }
  return moved;
}

let migrated = false;

/** 在浏览器里跑一次迁移（幂等）。返回迁移数量。 */
export function migrateLocalStorageKeys(): number {
  if (migrated) return 0;
  migrated = true;
  if (typeof localStorage === 'undefined') return 0;
  const moved = migrateKeysInStore(localStorage);
  if (moved > 0) {
    console.info(`[legacyRename] 已迁移 ${moved} 个 localStorage 键 kunpeng* → gdream*`);
  }
  return moved;
}

/** 仅供测试：重置幂等标记。 */
export function __resetLegacyRenameForTest(): void {
  migrated = false;
}
