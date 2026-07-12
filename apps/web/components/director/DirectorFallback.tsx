'use client';

export function DirectorFallback({message='当前设备无法启动 3D 预览'}:{message?:string}){
  return <div className="director-canvas-fallback" role="status"><strong>3D 预览不可用</strong><span>{message}</span></div>;
}
