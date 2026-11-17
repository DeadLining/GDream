# DSH 离线决策审计（provider-free）

只读指定的 `session.jsonl`，重建正式工具调用 trace，生成**待复核**的决策草案和词法规则基线。
不加载应用、不执行工具、不访问网络、不读取 API key，不修改 DSH 或项目状态。

## 运行

Python 3.11+，仅标准库。从 GDream 根目录运行：

```sh
python3 scripts/dsh-decision-audit/audit.py \
  --session /absolute/path/to/session.jsonl \
  --session /absolute/path/to/another-session.jsonl \
  --project proj-example \
  --out /absolute/path/outside-production/new-audit-directory

python3 -m unittest discover -s scripts/dsh-decision-audit -p 'test_*.py' -v
```

- 输入必须显式给出；不全盘搜集会话。选静止的历史会话，前后 SHA-256 不一致会失败。
- 输出目录必须不存在，拒绝覆盖、经过符号链接的路径、源会话目录、`~/.gdream` 和 GDream 仓库。
- 输出目录 0700，文件 0600；输出应位于私有实验工作区，不应提交 Git。
- 没有后台服务或生产配置。停用就是不再执行该命令；不需要生产回滚。

## 产物及其语义

| 文件 | 用途 |
|---|---|
| `sources.json` | 私有源路径、输入 SHA-256、会话统计和诊断 |
| `trace.jsonl` | 调用/结果行号、callId、turn/step/seq、状态、项目归属；没有完整参数 |
| `decisions.jsonl` | 当时可见的观察、历史摘要、未知项、候选草案、词法初筛、规则建议 |
| `outcomes.jsonl` | 时间上下一次观察到的调用；**不是因果，也不是标签** |
| `labels.jsonl` | 待独立标注的空模板，默认全部 `unlabeled` |
| `predictions.jsonl` | 空文件；没有调用模型，不编造预测 |
| `summary.json` / `report.md` | 机器/人类可读结果及限制 |

## 解析契约

1. 只统计 `tool/call` 和 `tool/result`，忽略 assistant/chunk/message 中的镜像。
2. 同文件内按 callId 关联；相同事件去重，冲突保留诊断，不静默覆盖。
3. 工具结果读取 `data.message.content[] -> tool-result -> content[] -> text`。
4. 保留文件物理顺序；seq 倒退只诊断，不排序，不将后来看到的调用补入过去快照。
5. 工具结果早于调用时只做 trace 配对，不生成该决策快照。缺失结果不当作失败或取消。
6. 损坏行、非法形状、非 UTF-8、超大行有诊断；缺少 isError 保留 unknown。
7. 未知事件不用于推断状态。取消回执若以 isError + 取消文字出现则保留；没有该回执不能猜测取消原因。
8. 项目归属来自显式 projectId/project_id，或之前观察到的状态。
   支持 `workshop_get_state` 的 project.id、真实分页首片段，以及 `project_get_paths.current.aigc_project_id`。
   不把 canvas_project_id 当工坊项目，不从网页或任意文本提及推断归属。
9. 在调用派发时捕获作用域；项目切换后的旧结果不自动归给新项目。
   状态首片段只能证明已经出现的项目身份，不能证明完整状态已读完。
10. `--project` 只筛选 decisions；私有 trace 仍保留其他/未知作用域，防止隐藏边界。
11. 不从现在的 project.json/workshop.json 补历史状态。上下文指纹只计算决策输入，不含未来结果、标签或源文件整体 hash。

## 基线与研究边界

规则优先识别重复相同失败、过期版本、缺字段、授权/源文件门禁；普通成功回执、空源列表无需模型。
检索/网页读取标记为“证据充分性或支持关系”的**研究假设**，不等于存在可评测的真实语义问题。
未知错误交给规划器检查；文本路径/回执不能完成视觉验收。

这不是线上 `ExecutionRecovery` 的完整重实现。重复失败建议也不意味着历史后续调用必然可避免。
历史主模型下一步、脚本生成的候选、Jev 预测均不能自行充当 gold。

所有候选 `executable=false`、`permission=not_evaluated`，所有样本 `candidate_set_verified=false`。
候选表达“下一步检查/规划建议”，不是可直接 dispatch 的工具调用，不放宽权限。
没有可信目标、完整的决策前证据、历史 revision、权限与独立标签之前，`evaluation_ready=false`。
基线 `call_model=false`；单个候选、视觉问题、规则问题都不会触发模型。

下一步应在私有实验区：
- 从语义假设中挑选具体、可标注的问题；补充仅在该决策前存在的来源行号与目标。
- 检查候选覆盖与互斥性、确认权限；盲于预测地标注可接受动作集合/偏好/禁止动作。
- 按项目/会话/关联重试组划分，不随机拆同一失败的连续重试。
- 若样本足够，再单独设计 mock 客户端及有预算的 API 评估；本工具没有联网开关。

## 隐私

默认不输出完整用户 prompt、完整参数、完整状态、图片或配置。只有错误和证据工具文本截取最多 900 字符，
先屏蔽常见密钥字段、Bearer、URL（含查询/签名）和本机用户路径。
**脱敏是尽力而为，不是可公开/可外传证明**，自然语言仍可能包含商业信息。
所有产物默认仅限本地；任何 API 评估前仍需人工字段复核、明确样本范围与预算。

## 定向证据整理与盲审包

`curate.py` 消费**本地私有的显式整理计划**，把指定历史片段组织成自包含判断题：

```sh
python3 scripts/dsh-decision-audit/curate.py \
  --plan /absolute/private/plan.json \
  --out /absolute/private/new-review-directory
```

计划给出源日志 SHA-256、每个样本的结果行/callId 截止点、引用的 JSON Pointer、
字符起止位置与期望原文，以及分析者编写的问题和选项。字符范围是 Python Unicode code point、左闭右开；
搜索工具内嵌 JSON 的引用还带 `embedded_json_pointer`，范围指向解码后的选定字符串，而非 JSON 转义字节。
计划包含原始片段，应仅保存在仓库外的私有目录。

构建器验证源 hash、引用范围和原文匹配；目标只能来自历史 `user/message`，
证据只能来自截止点及之前的成功 `tool/result`。不允许用后来 assistant 的研究总结代替先前来源。
任务上下文可能是系统拼装后的用户消息，不能声称都是用户逐字说的话。

输出：
- `packets.jsonl`：按时间截止的、脱敏的文本判断输入，无标签和后续行为。
- `blind-review.md`：同一输入的人类可读版本。
- `labels.blank.jsonl`：空白独立审阅模板。
- `provenance.json`：私有源文件、计划与实现哈希，不放进模型输入。

问题是分析者构造的诊断探针，不是原 DSH 的原封不动决策；可作题目设计与接口测试，
不能据此声称生产动作收益。准备者看过历史不等于真正盲法，需披露选题/选段偏差。
同一会话的所有题目共用 split_group。候选选项表示文本判断，不代表任何生产权限。

若另存助手初审，必须标注 `assistant_provisional`、`independent=false`、`eligible_for_scoring=false`，
不要预填空白标签，也不要把助手初审提供给独立审阅者后再称为无锚定标注。
