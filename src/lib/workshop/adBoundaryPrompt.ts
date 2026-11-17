/** Product-ad frame requests prioritize the authored still over dramatic scaffolding. */
export function buildAdBoundaryPrompt(input: {
 description: string;
 role: 'start' | 'end';
 aspectRatio: string;
 references: {label: string; kind?: string}[];
}): string {
 const refs=input.references.map((r,i)=>`图片${i+1}：${r.label}${r.kind==='start-frame'?'（最高优先级，保持构图、物体外观和光线，只改变目标描述要求的状态）':''}`).join('；');
 return [
  `广告${input.role==='start'?'开场':'结束'}静帧，目标画面：${input.description}`,
  `参考图按上传顺序：${refs}。按各图用途合成同一个完整场景，不要只复制场景底图而遗漏主体。`,
  `只输出一张${input.aspectRatio}完整画面，不画拼图、参考图边框、说明文字或水印。严格遵守目标描述，不自行添加人物、道具或剧情。`,
 ].join('\n');
}
