/**
 * unifiedProjectStore — Adobe 式统一项目协调层。
 *
 * 一个 AIGC 项目 = 工坊数据 + 专属画布（aigcProjectId 关联）+ 专属剪辑
 * 时间轴（editor.json）+ 专属对话集（Session.projectId）。
 * openUnified() 一次切齐四者；closeUnified() 回自由模式。
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';
import { useWorkshopStore } from './workshopStore';
import { useProjectStore } from './projectStore';
import { switchEditorProject } from '@/lib/editor/editorPersist';
import { ensureProjectSession } from '@/lib/projectSessions';

// Project opening is a latest-request-wins transaction. Several mounted surfaces
// can request a restore at the same time; dropping a request (the old
// `opening` guard) leaves the UI on the previous project's chat.
let openTail: Promise<void> = Promise.resolve();
let openRequestId = 0;

interface UnifiedProjectState {
  /** 当前打开的统一项目（= AIGC 项目 id）；null = 自由模式 */
  activeId: string | null;
  opening: boolean;

  openUnified: (aigcProjectId: string) => Promise<void>;
  /** 轻量恢复：只在已知项目上下文断开时调用，避免顶部切换栏丢失 */
  recoverUnified: (aigcProjectId?: string | null) => Promise<void>;
  closeUnified: () => Promise<void>;
  /** 找到（或创建）该 AIGC 项目的专属画布项目并切换 */
  ensureCanvasProject: (aigcProjectId: string, name: string) => Promise<string>;
}

export const useUnifiedProjectStore = create<UnifiedProjectState>()(persist((set, get) => ({
  activeId: null,
  opening: false,

  ensureCanvasProject: async (aigcProjectId, name) => {
    const ps = useProjectStore.getState();
    let canvas = ps.projects.find((p) => p.aigcProjectId === aigcProjectId);
    // 文件侧兜底：localStorage 关联丢失（曾因配额满写不进）时用 workshop.json 恢复
    if (!canvas) {
      const wsCanvasId = useWorkshopStore.getState().data?.canvasProjectId;
      if (wsCanvasId) {
        const byFile = ps.projects.find((p) => p.id === wsCanvasId);
        if (byFile) {
          ps.linkAigcProject(byFile.id, aigcProjectId);
          canvas = byFile;
        }
      }
    }
    // 领养幽灵画布：同名且未关联的画布（历史 bug 产物）直接收编，不再新建
    if (!canvas) {
      const orphan = ps.projects.find((p) => !p.aigcProjectId && p.name === name);
      if (orphan) {
        ps.linkAigcProject(orphan.id, aigcProjectId);
        canvas = orphan;
      }
    }
    if (!canvas) {
      const canvasId = await ps.createProject(name);
      ps.linkAigcProject(canvasId, aigcProjectId);
      canvas = useProjectStore.getState().projects.find((p) => p.id === canvasId);
    }
    // 兜底同步画布名跟随工坊名（修：在外部改了项目名后，画布 ProjectSwitcher 仍显示旧名）
    if (canvas && canvas.name !== name) {
      useProjectStore.getState().renameProject(canvas.id, name);
    }
    // canvasProjectId 写回 workshop.json（文件为源，双向自愈）
    const ws = useWorkshopStore.getState();
    if (ws.data && ws.data.projectId === aigcProjectId && ws.data.canvasProjectId !== canvas!.id) {
      useWorkshopStore.setState({ data: { ...ws.data, canvasProjectId: canvas!.id } });
      ws.scheduleSave();
    }
    return canvas!.id;
  },

  openUnified: (aigcProjectId) => {
    const requestId = ++openRequestId;

    // Publish the requested project immediately. This prevents App's recovery
    // effect from seeing the persisted project's id and jumping back while the
    // new project's files/session are being loaded.
    set({ activeId: aigcProjectId, opening: true });

    const run = openTail.catch(() => undefined).then(async () => {
      // Latest request wins. An older restore must not overwrite a newer click.
      if (requestId !== openRequestId) return;
      try {
        // 1) 工坊
        await useWorkshopStore.getState().openProject(aigcProjectId);
        if (requestId !== openRequestId) return;
        const workshopState = useWorkshopStore.getState();
        const project = workshopState.project;
        // openProject() historically returned void and silently kept the old
        // project when the requested file was missing. Never normalize that
        // stale object to the new id: it would bind the old chat/assets to the
        // newly clicked project.
        if (!project || project.id !== aigcProjectId || workshopState.data?.projectId !== aigcProjectId) {
          throw new Error(`读取工坊项目失败或项目上下文不一致：${aigcProjectId}`);
        }

        // Bind the chat before the slower canvas/editor restoration. Otherwise
        // the old project's conversation remains visible during the whole open
        // transaction and a fast click can look like an automatic jump back.
        await ensureProjectSession(aigcProjectId, project.name).catch(() => null);
        if (requestId !== openRequestId) return;

        // 2) 画布（确保存在 + 切换）
        const canvasId = await get().ensureCanvasProject(aigcProjectId, project.name);
        if (requestId !== openRequestId) return;
        await useProjectStore.getState().switchProject(canvasId);

        // 3) 剪辑时间轴
        await switchEditorProject(aigcProjectId);
        if (requestId !== openRequestId) return;

        // 4) 会话已在工坊加载后绑定；这里不再重复切换，避免并发
        // surface 在尾部再次加载旧会话。
      } finally {
        if (requestId === openRequestId) {
          set({ activeId: aigcProjectId, opening: false });
        }
      }
    });

    openTail = run;
    return run;
  },

  recoverUnified: async (aigcProjectId) => {
    const targetId = aigcProjectId ?? get().activeId;
    if (!targetId || get().opening) return;

    const ws = useWorkshopStore.getState();
    const ps = useProjectStore.getState();
    const currentCanvas = ps.projects.find((p) => p.id === ps.activeProjectId);

    // 如果工坊、画布、剪辑都已经对齐，只补 activeId，避免无意义重切。
    if (ws.project?.id === targetId && ws.data?.projectId === targetId && currentCanvas?.aigcProjectId === targetId) {
      if (get().activeId !== targetId) set({ activeId: targetId });
      return;
    }

    // 当前画布已经是这个 AIGC 项目的专属画布时，也用 openUnified 统一补齐工坊/剪辑。
    // 这里不改 activeView，只恢复背后的项目链路。
    await get().openUnified(targetId);
  },

  closeUnified: async () => {
    useWorkshopStore.getState().close();
    await switchEditorProject(null);
    set({ activeId: null });
  },
}), {
  name: 'gdream-unified-project',
  storage: createJSONStorage(() => safeLocalStorage),
  partialize: (s) => ({ activeId: s.activeId }),
  version: 1,
}));
