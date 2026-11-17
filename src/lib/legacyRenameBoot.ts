/**
 * legacyRenameBoot — 品牌更名迁移的「最早执行点」。
 *
 * 为什么单独开一个模块而不是在 main.tsx 里调用函数：
 *   ESM 的 import 是提升的，`import App from './App'` 会先把整张模块图
 *   （含所有 zustand store）求值完，store 在模块顶层就 `persist()` 并完成
 *   首次 rehydrate。等 main.tsx 的语句开始执行时，旧键的值已经错过窗口了。
 *
 *   把迁移放在本模块的顶层副作用里，并让 main.tsx 把它排在 App 之前 import，
 *   就能保证迁移先于任何 store 读取 localStorage。
 *
 * 迁移语义见 legacyRename.ts：复制、不移动、不清源，幂等。
 */
import { migrateLocalStorageKeys } from './legacyRename';

migrateLocalStorageKeys();
