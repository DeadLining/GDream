# Design Tokens 迁移对照表

> 用途：把 `apps/web/app/globals.css` 中散落的字面量，逐条映射到 `apps/web/app/tokens.css` 里的新 token。每个 PR 迁移一个面板时，按此表把对应字面量替换为 `var(--...)`。
>
> 命名约定：新 token 一律带前缀（`--color-*` / `--fs-*` / `--radius-*` / `--space-*` / `--control-h-*` / `--shadow-*` / `--font-*` / `--transition-*`）。暗色域（3D Director）带 `--dark-*` 前缀。

---

## 1. 中性色（亮色域）

| 老字面量 | 新 token | 出现位置示例 |
|---|---|---|
| `#ffffff` / `white` / `#fff` | `var(--color-surface)` | 卡片背景、输入框、按钮 |
| `#f4f6f7` | `var(--color-app)` | 应用背景 |
| `#f8f9fa` / `#f8f7f4` / `#f7fafb` / `#f8f6f2` | `var(--color-surface-subtle)` | 输入框背景、次级面板 |
| `#25282c` / `#252f33` | `var(--color-ink)` / `var(--color-text)` | 正文主色 |
| `#111` / `#111111` | `var(--color-ink-strong)` | 视频占位等纯黑 |
| `#5f676e` / `#57524c` / `#5e5952` / `#59615e` / `#625d56` / `#65615b` / `#5e5a54` | `var(--color-muted)` | 标签、section label、字段标题 |
| `#747c83` / `#747c83` | `var(--color-muted-soft)` | 最弱的辅助文字 |
| `#dfe3e6` | `var(--color-line)` | 标准分割线/边框 |
| `#eceae6` / `#eeeae3` / `#f1efeb` | `var(--color-line-soft)` | 卡片内弱分割 |
| `#cbc6bd` / `#c9c4bb` / `#d4cfc7` / `#cfd5d9` / `#aebbc2` / `#b9c0c5` | `var(--color-line-strong)` | 卡片轮廓、强调边框、hover 边框 |
| `#aaa49a` / `#9d968c` / `#878178` / `#a9a49b` | `var(--color-muted)` 或 `var(--color-line-strong)` | 视语境：文字用 muted，边框用 line-strong |

**侧栏暖灰系**（已被新版 Modern studio shell 替代，可考虑直接删）：

| 老字面量 | 新 token |
|---|---|
| `#ebe8e2` / `#dedad2` | 可映射到 `var(--color-surface-subtle)`，但建议在新 UI 中统一改为冷灰 `--color-surface-subtle` |
| `#171614` / `#24221f` / `#292724` / `#47433e` / `#4a4640` / `#393632` | 这是老版深色顶栏，新版顶栏已改白底，迁移时**直接删除这些选择器**而不是映射 |

---

## 2. 语义色

### 红/危险

| 老字面量 | 新 token | 语义 |
|---|---|---|
| `#d94438` | `var(--color-accent)` | 主操作色（激活态、链接强调） |
| `#bd352c` | `var(--color-accent-strong)` | 主按钮背景、hover |
| `#a92f27` | `var(--color-accent-press)` | active/press 态 |
| `#a72e26` | `var(--color-danger)` | 危险文字（小字错误提示） |
| `#8c2d27` | `var(--color-danger-strong)` | 危险文字加深（对话框错误） |
| `#9b332d` / `#9b342d` / `#a23830` | `var(--color-danger)` | 收敛到统一危险文字 |
| `#f8e4e2` | `var(--color-danger-bg)` | 危险背景 |
| `#b9473e` / `#c96a63` / `#e1b7b3` / `#e3b5b1` / `#ead1ce` / `#c98782` | `var(--color-danger-border)` | 危险左边框、错误态边框 |
| `#fff4f2` / `#fcf1f0` | `var(--color-danger-bg)` | 极浅危险背景，合并 |
| `#f8e9e7` | `var(--color-danger-bg)` | hover 态浅红，合并 |

### 绿/成功

| 老字面量 | 新 token | 语义 |
|---|---|---|
| `#2f7557` | `var(--color-success)` | 成功文字 |
| `#286044` / `#24633f` | `var(--color-success-strong)` | 健康指示、加深 |
| `#185f56` / `#125c53` / `#167164` | `var(--color-success-strong)` | 健康徽标、icon-button.active 态 |
| `#e3f1e9` / `#e4f2e9` / `#e4f2ef` / `#ebf5ef` / `#edf6f1` / `#e6efed` / `#e5efed` | `var(--color-success-bg)` | 成功/健康背景，统一 |
| `#b9d9c7` / `#c9d9dd` | `var(--color-success-bg)` 或 `var(--dark-muted-soft)` | 视语境 |

### 金/警告

| 老字面量 | 新 token | 语义 |
|---|---|---|
| `#b47b20` | `var(--color-warning)` | 警告边框 |
| `#705b24` / `#79571f` / `#7a5412` / `#7d5d20` | `var(--color-warning-text)` | 警告文字 |
| `#faf4e7` / `#f5edda` / `#f4ead5` | `var(--color-warning-bg)` | 警告背景 |

### 青/信息

| 老字面量 | 新 token | 语义 |
|---|---|---|
| `#2f6f7b` | `var(--color-info)` | 信息色 |
| `#285f69` | `var(--color-info-text)` | 信息文字 |
| `#edf2f3` / `#edf3f3` | `var(--color-info-bg)` | 信息背景 |

### 蓝/聚焦

| 老字面量 | 新 token |
|---|---|
| `#246bce` | `var(--color-focus)` |
| `#3f4f70` | `var(--color-info)`（合并到青色系） |

---

## 3. 暗色域（3D Director Workspace 专用）

> 这一组只在 `.director-workspace` 及其后代选择器内使用，**不要和亮色域混用**。

| 老字面量 | 新 token | 语义 |
|---|---|---|
| `#20282c` | `var(--dark-bg)` | 编辑器底色 |
| `#273136` / `#252f33` | `var(--dark-surface)` | 面板背景（object-tree / inspector） |
| `#293338` | `var(--dark-surface-alt)` | 工具条背景 |
| `#303b40` / `#303c41` / `#3b4a50` / `#39474d` / `#243136` | `var(--dark-elevated)` | 容器/按钮背景（合并） |
| `#3d494e` | `var(--dark-border)` | 标准分割 |
| `#46555b` / `#43535a` / `#44545a` / `#536269` | `var(--dark-border-strong)` | 卡片边框 |
| `#eef3f4` / `#edf3f5` / `#f2f6f7` | `var(--dark-text)` | 主文字 |
| `#9fb0b7` / `#81949c` / `#82979f` / `#aebdc2` | `var(--dark-muted)` | 次要文字 |
| `#b9c7cc` / `#c9d5d9` / `#c8d4d8` / `#cbd7da` / `#d8e2e5` / `#d8e3e6` / `#dbe7ea` | `var(--dark-muted-soft)` | 图标/辅助/激活态浅文字 |
| `#71868f` / `#60747c` | `var(--dark-border-strong)` | 暗色按钮边框，合并 |

---

## 4. 字号

| 老字面量 | 新 token | 用途 |
|---|---|---|
| `9px` | `var(--fs-xs)` | 极小标签（runtime-status、dt） |
| `10px` | `var(--fs-xs)` | 标签、徽标、辅助（合并到 xs） |
| `11px` | `var(--fs-sm)` | 元信息、小字 |
| `12px` | `var(--fs-base)` | 正文默认 |
| `13px` | `var(--fs-md)` | 列表项标题 |
| `14px` | `var(--fs-lg)` | 区块小标题 |
| `15px` | `var(--fs-lg)` | 合并到 lg |
| `18px` | `var(--fs-xl)` | 面板标题 |
| `19px` / `20px` / `21px` | `var(--fs-xl)` | 合并到 xl |
| `22px` | `var(--fs-2xl)` | 页面主标题 |
| `23px` / `24px` / `25px` | `var(--fs-3xl)` | 大字读数，合并 |
| `0` | — | 删除（keyframes 里的 transform 用） |

---

## 5. 圆角

| 老字面量 | 新 token |
|---|---|
| `3px` | `var(--radius-sm)` |
| `4px` | `var(--radius-sm)` |
| `5px` | `var(--radius-md)` 合并（视觉差异极小） |
| `6px` | `var(--radius-md)` |
| `50%` | `var(--radius-circle)` |

---

## 6. 间距

> 原 3/4/5/6/7/8/9/10/11/12/14/16/18/22/24px 全部按下表归并。特殊布局（如 `padding: 0 9px`）可保留或用 `calc(var(--space-2) + 1px)`。

| 老字面量 | 新 token |
|---|---|
| `3px` / `4px` | `var(--space-1)` |
| `5px` / `6px` / `7px` / `8px` | `var(--space-2)` |
| `9px` / `10px` / `11px` / `12px` | `var(--space-3)` |
| `14px` / `16px` | `var(--space-4)` |
| `18px` / `20px` | `var(--space-5)` |
| `22px` / `24px` | `var(--space-6)` |
| `32px`+ | `var(--space-8)` |

---

## 7. 控件高度

| 老字面量 | 新 token |
|---|---|
| `30px` | `var(--control-h-sm)` |
| `32px` / `34px` / `36px` | `var(--control-h-md)` |
| `38px` | `var(--control-h-lg)` |

---

## 8. 阴影

| 老字面量 | 新 token |
|---|---|
| `0 1px 2px rgb(37 40 44 / 4%)` | `var(--shadow-sm)` |
| `0 7px 20px rgb(37 40 44 / 14%)` | `var(--shadow-md)` |
| `0 12px 30px rgb(37 40 44 / 18%)` | `var(--shadow-lg)` |

---

## 9. 字体族

| 老字面量 | 新 token |
|---|---|
| `Arial, "PingFang SC", "Microsoft YaHei", sans-serif` | `var(--font-sans)` |
| `ui-monospace, SFMono-Regular, Menlo, monospace` | `var(--font-mono)` |

---

## 10. 过渡

| 老字面量 | 新 token |
|---|---|
| `120ms ease`（transition 的 duration 部分） | `var(--transition-fast)` |

---

## 迁移操作模板

迁移某个选择器时，按以下步骤：

```diff
- .shot-card { border: 1px solid #d4cfc7; border-radius: 6px; }
+ .shot-card { border: 1px solid var(--color-line-strong); border-radius: var(--radius-md); }
```

```diff
- .inspector-section label { font-size: 11px; color: #625d56; }
+ .inspector-section label { font-size: var(--fs-sm); color: var(--color-muted); }
```

**自检规则**（迁移完一个面板后用这条 grep 验证）：

```bash
# 该面板相关选择器内不应再出现任何 #xxxxxx 字面量
grep -nE "#[0-9a-fA-F]{3,6}" apps/web/app/globals.css | grep -E "\.inspector|\.shot-card"
```

---

## 兼容性说明

`tokens.css` 末尾的"兼容别名"段保证现有 `var(--ink)` / `var(--accent)` / `var(--red)` 等旧写法**仍能正常工作**，所以本次改动不会破坏任何现有渲染。迁移是渐进的：你可以在任何时候把某个选择器里的老 token 替换成新 token，而不需要一次性全改。

迁移全部完成后，可以删除 `tokens.css` 末尾的兼容别名段，以及 `globals.css` 里残留的暖灰色系（已被 Modern studio shell 取代）。
