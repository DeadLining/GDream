/** Explicit boundary generation must never fall through to video submission. */
export function generationRequest(requested: unknown, skipPromptValidation: boolean, role?: unknown): {
 kind: 'asset' | 'image' | 'video';
 options: {skipPromptValidation: boolean; boundaryFramesOnly?: boolean; boundaryFrameRole?: 'both' | 'start' | 'end'};
 label: string;
} {
 if (role === null || (requested !== 'boundary' && role === 'both')) role = undefined;
 if (role !== undefined && (requested !== 'boundary' || !['both','start','end'].includes(String(role)))) throw new Error('frame_role 仅支持 boundary 类型的 both/start/end');
 if (requested === 'boundary') return {kind:'video',options:{skipPromptValidation,boundaryFramesOnly:true,...(role !== undefined ? {boundaryFrameRole: role as 'both' | 'start' | 'end'} : {})},label:role === 'end' ? '尾帧' : role === 'start' ? '首帧' : '首尾帧'};
 if (requested !== 'asset' && requested !== 'image' && requested !== 'video') throw new Error('不支持的生成类型');
 return {kind:requested,options:{skipPromptValidation},label:requested === 'video' ? '视频' : '图'};
}
export function needsGeneration(kind: unknown, shot: {imagePath?: string; videoPath?: string; videoStartFramePath?: string; videoEndFramePath?: string}): boolean {
 if (kind === 'boundary') return !shot.videoStartFramePath || !shot.videoEndFramePath;
 return kind === 'image' ? !shot.imagePath : !shot.videoPath;
}
