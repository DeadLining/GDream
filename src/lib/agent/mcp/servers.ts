import type { McpServerConfig } from './types';

/**
 * 内置 MCP 列表。
 *
 * Blender/白模桥接已移除，不再在应用启动时自动拉起外部 MCP 进程。
 * 联网搜索、图片读取和网页读取均走 GDream 内置工具桥。
 */
export const MCP_SERVERS: McpServerConfig[] = [];
