// ── Agent Metadata ──────────────────────────────────────────────────────────

export interface AgentMeta {
  name: string;
  icon: string;
  description: string;
  slogan: string;
  suggestions: string[];
  /**
   * Optional runtime overrides. The product currently exposes only the single
   * GDream assistant, but these fields are kept for backward-compatible
   * settings hydration.
   */
  preferredProviderId?: string;
  outputStyle?: 'default' | 'concise' | 'verbose' | 'coding';
  systemPromptAddition?: string;
}

export const DEFAULT_AGENT_METAS: Record<string, AgentMeta> = {
  main: {
    name: 'GDream',
    icon: '🐋',
    description: '让灵感像鲸鱼一样自由遨游',
    slogan: '把每一个想法，变成看得见的梦',
    suggestions: [
      '帮我写一段代码',
      '解释一个概念',
      '翻译成中文',
      '总结这篇文章',
      '分析数据趋势',
      '写一封邮件',
      '制定学习计划',
      '头脑风暴创意',
      '检查语法错误',
    ],
  },
};
