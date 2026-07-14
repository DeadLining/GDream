import {Focus,LayoutDashboard,Maximize2,Undo2} from 'lucide-react';

export function ProductionCanvasToolbar({onLayout,onUndo,canUndo,onFitAll,onFocusSelection,canFocus}:{onLayout:()=>void;onUndo:()=>void;canUndo:boolean;onFitAll:()=>void;onFocusSelection:()=>void;canFocus:boolean}){
  return <div className="production-canvas-toolbar" aria-label="画布工具栏">
    <button title="自动布局" aria-label="自动布局" onClick={onLayout}><LayoutDashboard size={16}/></button>
    <button title="撤销布局" aria-label="撤销布局" onClick={onUndo} disabled={!canUndo}><Undo2 size={16}/></button>
    <span className="production-toolbar-divider"/>
    <button title="显示整集" aria-label="显示整集" onClick={onFitAll}><Maximize2 size={16}/></button>
    <button title="聚焦当前镜头" aria-label="聚焦当前镜头" onClick={onFocusSelection} disabled={!canFocus}><Focus size={16}/></button>
  </div>;
}
