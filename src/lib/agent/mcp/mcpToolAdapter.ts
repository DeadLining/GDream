import type { McpTransport } from './transport';
import type { McpToolSchema, McpToolCallResult } from './types';
import type { Tool, ToolDefinition, ToolResult } from '../types';
import { agentLog } from '../logger';
import { invoke } from '@tauri-apps/api/tauri';
import { createDir, writeBinaryFile } from '@tauri-apps/api/fs';

/**
 * 将 MCP inputSchema.properties 转为 ToolDefinition 的 parameters.properties 格式
 * MCP 使用完整 JSON Schema，ToolDefinition 使用简化的 { type, description, enum, default }
 */
function convertProperties(
  props: Record<string, unknown> | undefined,
): Record<string, { type: string; description?: string; enum?: string[]; default?: unknown }> {
  if (!props) return {};

  const result: Record<string, { type: string; description?: string; enum?: string[]; default?: unknown }> = {};

  for (const [key, schema] of Object.entries(props)) {
    const s = schema as Record<string, unknown>;

    let type = 'string';
    if (typeof s.type === 'string') {
      type = s.type;
    } else if (Array.isArray(s.type)) {
      // e.g. ["string", "null"] → "string"
      type = s.type.find((t: string) => t !== 'null') || 'string';
    }

    const prop: { type: string; description?: string; enum?: string[]; default?: unknown } = { type };

    if (typeof s.description === 'string') {
      prop.description = s.description;
    }

    if (Array.isArray(s.enum)) {
      prop.enum = s.enum.map(String);
    }

    if (s.default !== undefined) {
      prop.default = s.default;
    }

    result[key] = prop;
  }

  return result;
}

/**
 * 将 MCP 工具 schema 转为 ToolRegistry 兼容的 Tool 对象
 */
export function createMcpTool(
  schema: McpToolSchema,
  prefix: string,
  transport: McpTransport,
): Tool {
  const prefixedName = `${prefix}_${schema.name}`;

  const definition: ToolDefinition = {
    name: prefixedName,
    description: schema.description || prefixedName,
    parameters: {
      type: 'object',
      properties: convertProperties(schema.inputSchema.properties),
      required: schema.inputSchema.required,
    },
  };

  return {
    definition,
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      try {
        agentLog.info('MCP-Tool', `→ ${prefixedName}`, params);
        const response = await transport.request('tools/call', {
          name: schema.name, // 用原始名，不带前缀
          arguments: params,
        });

        if (response.error) {
          agentLog.error('MCP-Tool', `← ${prefixedName} error [${response.error.code}]`, response.error.message);
          return {
            success: false,
            output: '',
            error: `MCP error [${response.error.code}]: ${response.error.message}`,
          };
        }

        const result = response.result as McpToolCallResult;

        if (result.isError) {
          const errorText = result.content
            .map((c) => c.text || '')
            .filter(Boolean)
            .join('\n');
          agentLog.error('MCP-Tool', `← ${prefixedName} isError`, errorText);
          return {
            success: false,
            output: '',
            error: errorText || 'MCP tool returned an error',
          };
        }

        // MCP image blocks may originate on a remote host. Materialize them
        // locally before exposing the result to downstream workshop tools.
        const localImages: Array<{ path: string; data: string; mimeType: string }> = [];
        const materializationErrors: string[] = [];
        const verifiedLocalFiles: string[] = [];
        for (const [index, block] of result.content.entries()) {
          if (block.type !== 'image' || !block.data) continue;
          try {
            const homeDir = String(await invoke('get_home_dir')).replace(/[\\/]$/, '');
            const dir = `${homeDir}/.gdream/mcp`;
            await createDir(dir, { recursive: true });
            const ext = (block.mimeType || 'image/png').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'png';
            const hash = Array.from(block.data.slice(0, 64)).reduce((sum, ch) => ((sum * 31) + ch.charCodeAt(0)) >>> 0, 7).toString(36);
            const path = `${dir}/mcp-${Date.now()}-${index}-${hash}.${ext}`;
            const encoded = block.data.replace(/^data:[^,]+,/, '').replace(/\s/g, '');
            const binary = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
            await writeBinaryFile(path, binary);
            // Confirm the path is visible to the local Tauri process before it
            // is handed to workshop reference state. This rejects a failed
            // write (or an accidentally remote path) at the boundary.
            const metadata = await invoke<{ size?: number }>('get_file_metadata', { path });
            if (!metadata || Number(metadata.size) !== binary.byteLength) {
              throw new Error(`本机文件校验失败：${path}`);
            }
            localImages.push({ path, data: block.data, mimeType: block.mimeType || 'image/png' });
          } catch (error) {
            agentLog.warn('MCP-Tool', `failed to materialize image block from ${prefixedName}`, error);
            materializationErrors.push(error instanceof Error ? error.message : String(error));
          }
        }

        // Some MCP servers return a small JSON record that points at an already
        // transferred local file instead of an inline image block. Promote and
        // verify that path uniformly for downstream tools.
        for (const block of result.content) {
          if (block.type !== 'text' || !block.text) continue;
          try {
            const record = JSON.parse(block.text) as { local_path?: unknown; bytes?: unknown };
            if (typeof record.local_path !== 'string' || !record.local_path.startsWith('/')) continue;
            const metadata = await invoke<{ size?: number }>('get_file_metadata', { path: record.local_path });
            if (!metadata || Number(metadata.size) <= 0 || (record.bytes !== undefined && Number(metadata.size) !== Number(record.bytes))) {
              throw new Error(`本机文件校验失败：${record.local_path}`);
            }
            verifiedLocalFiles.push(record.local_path);
          } catch (error) {
            // Ordinary textual MCP results are not JSON transfer records.
            if (/local_path|exact|sha256/.test(block.text)) {
              materializationErrors.push(error instanceof Error ? error.message : String(error));
            }
          }
        }

        // Concatenate all content blocks
        const output = result.content
          .map((c) => {
            if (c.type === 'text' && c.text) return c.text;
            if (c.type === 'image') return `[image: ${c.mimeType || 'unknown'}]`;
            return '';
          })
          .filter(Boolean)
          .join('\n');

        const localImageOutput = localImages.length > 0
          ? `\n本地图片文件：${localImages.map((item) => item.path).join('\n')}`
          : '';
        const localFileOutput = verifiedLocalFiles.length > 0
          ? `\n本地图片文件：${verifiedLocalFiles.join('\n')}`
          : '';
        const materializationOutput = materializationErrors.length > 0
          ? `\n图片回传到GDream本机失败：${materializationErrors.join('；')}`
          : '';
        // The image has already been materialized locally. Do not echo its
        // base64 payload back into the model context: large screenshots can
        // exceed the tool-response budget and get reported as truncated.
        return {
          success: materializationErrors.length === 0,
          output: `${output || '(no output)'}${localImageOutput}${localFileOutput}${materializationOutput}`,
          error: materializationErrors.length > 0 ? materializationOutput.trim() : undefined,
        };
      } catch (err) {
        agentLog.error('MCP-Tool', `← ${prefixedName} transport error`, err);
        return {
          success: false,
          output: '',
          error: `MCP transport error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
