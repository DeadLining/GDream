import { qualityReviewEndpoint, type QualityReviewKind } from './qualityReview.ts';

export type QualityReviewContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'video_url'; video_url: { url: string } };

export interface QualityReviewRequestDescriptor {
  url: string;
  headers?: Record<string, string>;
  payload: {
    model: string;
    temperature: number;
    response_format: { type: 'json_object' };
    messages: Array<
      | { role: 'system'; content: string }
      | { role: 'user'; content: QualityReviewContentPart[] }
    >;
  };
}

export function qualityReviewSystemPrompt(kind: QualityReviewKind): string {
  const dimensions = kind === 'boundary-frames'
    ? '人物身份与尺度、人物相对位置和朝向、场景拓扑、道具状态、光影、构图、动作起止状态、字幕水印与肢体畸形'
    : '画面连续性、动作完整性、角色稳定性、人物朝向与轴线、声画同步、画面质量、转场与流程合规性';
  return [
    '你是GDream短剧生产的多模态质量审核器。只做审核，不改写剧情。',
    `审核维度：${dimensions}。`,
    '必须返回单个 JSON 对象，不要输出 Markdown。',
    'JSON schema：{"passed":boolean,"score":0-100,"summary":string,"issues":[{"code":string,"severity":"warning"|"error","target":"start-frame"|"end-frame"|"both-frames"|"video"|"unknown","message":string,"location":string,"repair_hint":string}]}。',
    'code 仅使用 character-identity、character-scale、character-position、scene-continuity、lighting-continuity、prop-continuity、composition-continuity、action-mismatch、audio-sync、visual-artifact、policy、unknown。',
    '首帧问题 target=start-frame，尾帧问题 target=end-frame，两帧共同不一致 target=both-frames，成片问题 target=video。',
    '只有不存在 error 时 passed 才能为 true。问题描述必须具体到可观察事实，repair_hint 只给最小修复建议。',
  ].join('\n');
}

export function buildQualityReviewContent(input: {
  kind: QualityReviewKind;
  prompt: string;
  startFrameUrl?: string;
  endFrameUrl?: string;
  videoUrl?: string;
}): QualityReviewContentPart[] {
  const content: QualityReviewContentPart[] = [{
    type: 'text',
    text: `${input.kind === 'boundary-frames' ? '审核本镜首帧与尾帧' : '审核本镜视频成片'}。\n\n镜头生成提示词：\n${input.prompt}`,
  }];
  if (input.startFrameUrl) {
    content.push({ type: 'text', text: '以下图片是本镜首帧（0 秒起点）：' });
    content.push({ type: 'image_url', image_url: { url: input.startFrameUrl } });
  }
  if (input.endFrameUrl) {
    content.push({ type: 'text', text: '以下图片是本镜尾帧（结束时刻）：' });
    content.push({ type: 'image_url', image_url: { url: input.endFrameUrl } });
  }
  if (input.videoUrl) {
    content.push({ type: 'text', text: '以下视频是需要终审的完整单镜成片：' });
    content.push({ type: 'video_url', video_url: { url: input.videoUrl } });
  }
  return content;
}

export function buildQualityReviewRequestDescriptor(input: {
  baseUrl: string;
  model: string;
  apiKey?: string;
  kind: QualityReviewKind;
  prompt: string;
  startFrameUrl?: string;
  endFrameUrl?: string;
  videoUrl?: string;
}): QualityReviewRequestDescriptor {
  const apiKey = input.apiKey?.trim();
  return {
    url: qualityReviewEndpoint(input.baseUrl, 'chat'),
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    payload: {
      model: input.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: qualityReviewSystemPrompt(input.kind) },
        { role: 'user', content: buildQualityReviewContent(input) },
      ],
    },
  };
}
