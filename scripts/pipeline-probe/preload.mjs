/**
 * 在 Node 里加载打包后的仓库模块所需的浏览器全局垫片。
 *
 * 这些模块原本跑在 WebView 里，求值阶段就会读 navigator / window / document
 * / localStorage。我们只取提示词、工具 schema 和纯校验函数，不需要真实 IPC
 * 或渲染能力，因此垫成可用的空壳即可。
 */
export function installShims() {
  const g = globalThis;

  const storage = makeStorage();

  const documentStub = {
    createElement: () => makeElement(),
    createTextNode: () => ({ textContent: '' }),
    createDocumentFragment: () => makeElement(),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    documentElement: makeElement(),
    head: makeElement(),
    body: makeElement(),
    cookie: '',
  };

  const windowStub = {
    __TAURI__: undefined,
    document: documentStub,
    location: { href: 'http://localhost/', protocol: 'http:', hostname: 'localhost' },
    localStorage: storage,
    sessionStorage: storage,
    navigator: { appVersion: 'node', userAgent: 'node', platform: 'MacIntel', language: 'zh-CN' },
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    getComputedStyle: () => makeElement().style,
    requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    setTimeout,
    clearTimeout,
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL() {} },
  };
  windowStub.window = windowStub;
  windowStub.self = windowStub;
  windowStub.top = windowStub;
  windowStub.parent = windowStub;

  // Node 22 起 navigator 是只读全局 getter，直接赋值会静默失败，必须 defineProperty。
  define(g, 'window', windowStub);
  define(g, 'document', documentStub);
  define(g, 'navigator', windowStub.navigator);
  define(g, 'self', windowStub);
  define(g, 'localStorage', storage);
  define(g, 'sessionStorage', storage);
}

function define(target, key, value) {
  try {
    Object.defineProperty(target, key, { value, configurable: true, writable: true });
  } catch {
    try { target[key] = value; } catch { /* 只读且不可配置时放弃 */ }
  }
}

function makeElement() {
  const el = {
    style: {},
    dataset: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    appendChild(child) { el.children.push(child); return child; },
    removeChild(child) { return child; },
    insertBefore(child) { return child; },
    remove() {},
    cloneNode() { return makeElement(); },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }),
    focus() {},
    blur() {},
    click() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getContext: () => null,
    toDataURL: () => 'data:,',
    textContent: '',
    innerHTML: '',
  };
  return el;
}

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}
