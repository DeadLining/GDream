import { useEffect } from 'react';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useProjectStore } from '@/stores/projectStore';
import { syncWorkshopLineageToCanvas } from '@/lib/workshop/canvasSync';
import { canSyncWorkshopCanvas } from '@/lib/workshop/liveCanvasPolicy';

/** One-way projection only: never runs a generator or adopts a candidate. */
export function useWorkshopCanvasSync() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (disposed) return;
        const { project, data, loading } = useWorkshopStore.getState();
        const { activeProjectId, switching } = useProjectStore.getState();
        if (loading || !project || !data || data.projectId !== project.id || !canSyncWorkshopCanvas(data.canvasProjectId, activeProjectId, switching)) return;
        void syncWorkshopLineageToCanvas().catch((error) => console.error('[workshop-canvas-sync] 同步失败', error));
      }, 400);
    };
    const unsubscribeWorkshop = useWorkshopStore.subscribe((state, previous) => {
      if (state.data !== previous.data || state.project !== previous.project || state.loading !== previous.loading) schedule();
    });
    const unsubscribeProject = useProjectStore.subscribe((state, previous) => {
      if (state.activeProjectId !== previous.activeProjectId || state.switching !== previous.switching) schedule();
    });
    schedule();
    return () => { disposed = true; clearTimeout(timer); unsubscribeWorkshop(); unsubscribeProject(); };
  }, []);
}
