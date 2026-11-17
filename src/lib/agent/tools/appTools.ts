import type { Tool } from '../types';
import { useChatStore, type ActiveView } from '@/stores/chatStore';
import { isToolEnabled } from '../toolGating';

const VIEWS: ActiveView[] = ['editor', 'canvas', 'workshop', 'projects', 'library'];

export const switchViewTool: Tool = {
  definition: {
    name: 'switch_view',
    description: '切换GDream当前视图。用于 agent 需要使用某类视图工具但当前视图不对时，例如 workshop_* 先切到 workshop，timeline_* 先切到 editor。',
    parameters: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: VIEWS, description: '目标视图：projects=项目列表，workshop=工坊，canvas=画布，editor=剪辑' },
      },
      required: ['view'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const view = String(params.view ?? '') as ActiveView;
    if (!VIEWS.includes(view)) {
      return { success: false, output: '', error: `未知视图 ${params.view}。可用：${VIEWS.join(', ')}` };
    }
    useChatStore.getState().setActiveView(view);
    const sampleTools = [
      'timeline_get_state',
      'timeline_add_clip',
      'timeline_add_audio',
      'timeline_set_export',
      'timeline_export_video',
      'workshop_get_state',
      'canvas_get_state',
      'project_get_paths',
    ].filter(isToolEnabled);
    return {
      success: true,
      output: JSON.stringify({
        activeView: view,
        visibleToolHints: sampleTools,
        next: view === 'editor'
          ? '现在可读取时间轴、添加视频/音频、设置导出参数并完成成片导出。先调用 timeline_get_state，随后按需使用 timeline_add_clip、timeline_add_audio、timeline_set_export、timeline_export_video。'
          : view === 'workshop'
            ? '现在可调用 workshop_get_state 读取工坊分镜和资产。'
            : view === 'canvas'
              ? '现在可调用 canvas_get_state 读取画布节点和任务。'
              : '已切换视图。',
      }, null, 2),
    };
  },
};

export const viewCapabilitiesTool: Tool = {
  definition: {
    name: 'view_capabilities',
    description: '查看GDream各工作区的 Agent 能力入口。工具因视图按需加载时，先用它确认目标视图和代表性工具，再 switch_view。',
    parameters: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: VIEWS, description: '可选目标视图；不填返回全部工作区摘要' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const capabilities: Record<string, { label: string; tools: string[]; note: string }> = {
      editor: { label: '剪辑', tools: ['timeline_get_state', 'timeline_add_clip', 'timeline_add_audio', 'timeline_add_overlay', 'timeline_add_scene', 'timeline_add_free_page', 'timeline_render_frame', 'timeline_set_export', 'timeline_export_analyze', 'timeline_export_video', 'timeline_export_status'], note: '支持从素材落轨、动效合成、逐帧验收到设置参数和导出成片的完整闭环' },
      canvas: { label: '画布', tools: ['canvas_get_state', 'canvas_get_selection', 'canvas_capture_node', 'canvas_generate', 'canvas_generate_batch', 'storyboard_list_targets', 'storyboard_writeback_frame', 'canvas_compose_storyboard_board'], note: '节点、连线、单节点/批量并行生成、单格回传和多图拼板' },
      workshop: { label: '工坊', tools: ['workshop_get_state', 'workshop_generate', 'storyboard_list_targets', 'storyboard_send_to_canvas'], note: '分镜、资产、批量生成和故事板画布精修' },
      projects: { label: '项目', tools: ['project_get_paths'], note: '项目和工作区路径' },
      library: { label: '产物库', tools: [], note: '查看项目产物' },
    };
    const view = String(params.view ?? '');
    if (view) return { success: true, output: JSON.stringify({ view, ...capabilities[view], next: `调用 switch_view({view:"${view}"}) 后再使用该工作区工具。` }, null, 2) };
    return { success: true, output: JSON.stringify({ active_view: useChatStore.getState().activeView, capabilities }, null, 2) };
  },
};

export const allAppTools: Tool[] = [switchViewTool, viewCapabilitiesTool];
