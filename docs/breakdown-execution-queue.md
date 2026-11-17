# Step ②：正文片段执行队列

## 行为

- `ExecutionRecovery` 为普通 Agent 与 DSH 提供同一份、不可被聊天压缩丢失的当前任务。
- `breakdownQueue.ts` 从已保存分集正文派生有序窗口，默认最多 2400 UTF-16 字符，优先换行边界且不拆代理对。拼接所有窗口必须等于原文。
- 单元 ID 绑定 revision、集号、整集正文指纹和片段序号。换版不删除旧镜头，但旧完成记录不再冒充新版完成。
- `workshop_set_shots` 可同时保存分镜和 `workUnitId` 对应的进度。中间批 `workUnitComplete=false`，最后一批才为 true。队列写入仅 merge、每批至多8镜，禁止改写已有镜头。
- `workshop_complete_breakdown_unit` 为既有镜头登记来源覆盖，不重写内容；只能引用当前片段所属集已保存的真实镜号。
- 回执保存在 `WorkshopData.breakdownWork`，镜头/回执随同一次项目提交保存。恢复任务先派发未完成片段，不按“一集已有一镜”判断完成。
- 没有正文也没有镜头的集先补正式剧本。没有正文但已有镜头的历史集保留，不自动重构历史内容。
- 失败批次参数保留在本轮 recovery 中，跨上下文压缩仍可定向修复；事实锁拒绝的 payload 也写入原有 rejected-shots 文件。网络中断后可以从项目的成功回执继续，不能声称所有失败都可自动修复。
- UI 的片段计数是执行登记，不是语义完整性评分。模型仍负责判断哪些镜头覆盖原文；程序只确认真实来源版本、保存状态和集归属。不会恢复 Atomic Shot 质量/Beat/动作轨道验收。

## 回归

- `npm run test:harness`
- `npm run test:breakdown-queue`：真实 coordinator/DSH bridge → registry → workshop tools → store，注入模型传输和内存持久化；覆盖首次结构、五集部分完成、单片段多批、失败修正、中断恢复、旧镜头保护、假完成与跨集引用。
- `npm run test:execution-recovery`
- `npm run test:episode-script-integration`
- `npm run test:context`
- `npx tsc --noEmit`

这些是离线回归，不等价于真实供应商/安装包验收。没有调用付费媒体或写入真实用户项目。DSH runtime 的本地生命周期测试仍受缺少 `@modelcontextprotocol/sdk` 影响；未修改锁定的 vendored runtime。

## 旧镜头进度衔接修复

- 自然语言“保留35条镜头…补登记完成记录…缺失部分继续拆解”与按钮进入相同执行路径，而不是默认30轮聊天。纯解释、只读检查或仅登记（未授权继续拆镜）不升级为全量执行任务。
- 第②步进度卡提供“核对已有镜头并继续”，运行中禁用，保留旧镜头。
- 检查点携带本集全部旧镜头的精简事实，不再仅最后4镜；超出12k字符时通过 `workshop_get_state(section:"breakdown-work",work_unit_id:...)` 分页。排除媒体、生成提示词等无关大字段。
- 有分集正文时也必须完成正在读取的快照续页，不能重新回到第一页。
- 拆解耗尽执行预算会作为未完成错误报告，不再作为成功回复给出通用“缩小范围重试”。
- 增补实际引擎回归：同一自然语言请求，35镜、1/9记录，只补8个完成记录，保持35镜逐字段不变；同时覆盖精简状态工具多页读取。模型传输仍为离线注入，不代表真实供应商保证一次成功。
