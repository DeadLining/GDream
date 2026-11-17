import { fetch as tauriFetch, Body, ResponseType } from '@tauri-apps/api/http';
import type { Tool } from '../types';
import { isToolEnabled } from '../toolGating';
import { prepareTemporalSearchQuery } from '../temporalContext';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import { tavilySearch, TAVILY_MCP_URL } from '../search/tavilyMcp';

export const webSearchTool: Tool = {
  definition: {
    name: 'web_search',
    description: '使用 Tavily 搜索实时网页资料，返回正文摘要、来源 URL 和图片 URL。图片需用 read_image 读取后由当前模型观察。涉及今天、最新或今年时，以系统当前日期为准，不要凭记忆添加年份。已知 URL 用 web_fetch，动态或登录页面用 browser_control。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词/问题，最多 2000 字符' },
        limit: { type: 'number', description: '结果条数，默认 8，上限 20' },
      },
      required: ['query'],
    },
  },
  risk: 'safe',
  async execute(params, signal) {
    if (!isToolEnabled('web_search')) return { success: false, output: '', error: '联网搜索未开启，请点击「联网」按钮开启后重试。' };
    if (typeof params.query !== 'string' || !params.query.trim() || params.query.length > 2000) return { success: false, output: '', error: '搜索词须为 1–2000 字符' };
    const temporal = prepareTemporalSearchQuery(params.query);
    try {
      const output = await tavilySearch(
        (headers, body) => tauriFetch(TAVILY_MCP_URL, {
          method: 'POST', headers, body: Body.json(body), responseType: ResponseType.Text, timeout: 30,
        }),
        resolveApiKey(useSettingsStore.getState(), 'tavily', ''),
        temporal.query, params.limit, signal,
      );
      const prefix = (temporal.isTimeSensitive ? `[搜索时间锚点：${temporal.context.isoDate} ${temporal.context.timeZone}]\n` : '')
        + (temporal.correctedFrom ? `[已纠正矛盾日期：${temporal.correctedFrom} → ${temporal.query}]\n` : '');
      return { success: true, output: prefix + output };
    } catch (error) {
      return { success: false, output: '', error: error instanceof Error ? error.message : 'Tavily 搜索失败' };
    }
  },
};
