import React from 'react';
import ReactDOM from 'react-dom/client';
// ⚠️ 必须排在 ./App 之前：本模块 import 时就把 kunpeng-* / kunpeng.* 的
// localStorage 值复制到 gdream-* / gdream.*，供随后求值的 store 读取。
import './lib/legacyRenameBoot';
import App from './App';
import { applyPrivateDefaults } from './lib/privateDefaults';
import './index.css';
import { initializeSettings } from './stores/settingsStore';

// No app effects, providers or private defaults may write before disk recovery.
const root = ReactDOM.createRoot(document.getElementById('root')!);
async function start() {
  root.render(<div role="status" style={{ padding: 32 }}>正在安全加载本机设置…</div>);
  try {
    await initializeSettings();
    await applyPrivateDefaults();
    root.render(<React.StrictMode><App /></React.StrictMode>);
  } catch {
    root.render(
      <div role="alert" style={{ padding: 32 }}>
        <h2>无法安全加载设置</h2>
        <p>现有配置未被覆盖。请检查 ~/.gdream/settings.json 的格式与读取权限，并关闭其他版本的 GDream 后重试。</p>
        <button onClick={() => void start()}>重新加载</button>
      </div>
    );
  }
}
void start();
