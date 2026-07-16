import type {APIRequestContext, APIResponse} from '@playwright/test';


type JsonObject = Record<string, unknown>;
type PipelineInput = {
  request: APIRequestContext;
  theme: string;
  timeoutMs: number;
  onStage?: (stage: string) => void;
};

type Project = JsonObject & {id: string; title: string};
type Character = JsonObject & {id: string; name: string};
type Episode = JsonObject & {id: string; title: string; scenes: Scene[]};
type Scene = JsonObject & {id: string; shots: Shot[]};
type Shot = JsonObject & {
  id: string;
  position: number;
  composition: string;
  image_prompt: string;
  active_panel_asset_id: string | null;
  active_video_asset_id: string | null;
  dialogue: Array<JsonObject & {id: string; text: string; audio_asset_id: string | null; duration_seconds: number}>;
};
type Asset = JsonObject & {
  id: string;
  media_url: string;
  media_type: string;
  provider: string;
  model: string;
  duration_seconds: number | null;
};
type Job = JsonObject & {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number;
  result_metadata: JsonObject;
  error: string;
};
type ScriptImport = JsonObject & {
  id: string;
  status: string;
  error: string;
  structured_draft: {characters: JsonObject[]; episodes: JsonObject[]};
};

export type ThemeToVideoResult = {
  theme: string;
  project: Project;
  episode: Episode;
  shot: Shot;
  script: {characters: number; episodes: number; bytes: number};
  panel: Asset & {bytes: number};
  video: Asset & {bytes: number};
  shots: Array<{shot_id: string; panel: Asset & {bytes: number}; video: Asset & {bytes: number}}>;
  speech: Array<{dialogue_id: string; asset: Asset & {bytes: number}}>;
  render: {
    path: string;
    media_url: string;
    bytes: number;
    review: JsonObject & {overall_pass: boolean};
  };
  release: {
    candidate: JsonObject & {id: string; status: string};
    gate: JsonObject & {ready: boolean};
    publication: JsonObject & {id: string; status: string};
  };
  timings_ms: Record<string, number>;
};

type FullEpisodeClosure = {
  episode: {scenes: Array<{shots: Array<{id: string; active_video_asset_id: string | null; dialogue: Array<{id: string; text: string}>}>}>};
  shots: Array<{shot_id: string; panel: {bytes: number}; video: {bytes: number}}>;
  speech: Array<{dialogue_id: string; asset: {bytes: number}}>;
  render: {bytes: number; review: {overall_pass: boolean}};
  release: {candidate: {id: string}; gate: {ready: boolean}; publication: {id: string; status: string}};
};

const DEFAULT_REAL_MODEL_TIMEOUT_MS = 120 * 60 * 1000;

export function resolveRealModelTimeoutMs(value: string | undefined): number {
  return Number(value ?? DEFAULT_REAL_MODEL_TIMEOUT_MS);
}

const wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

async function responseJson<T>(response: APIResponse, label: string): Promise<T> {
  if (response.ok()) return response.json() as Promise<T>;
  const body = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 1000);
  throw new Error(`${label} failed with HTTP ${response.status()}: ${body || 'empty response'}`);
}

export function parseScriptSse(body: string): string {
  let script = '';
  for (const frame of body.replace(/\r\n/g, '\n').split('\n\n')) {
    if (!frame.trim()) continue;
    let event = '';
    let data = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!event || !data) continue;
    const payload = JSON.parse(data) as {text?: string; message?: string};
    if (event === 'chunk') script += payload.text ?? '';
    if (event === 'error') throw new Error(payload.message || 'Script generation failed');
  }
  if (!script.trim()) throw new Error('Script generation returned no text');
  return script;
}

export function hasImageSignature(content: Buffer): boolean {
  const png = content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  const webp = content.length >= 12 && content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP';
  return png || jpeg || webp;
}

export function hasMp4Signature(content: Buffer): boolean {
  return content.length >= 12 && content.subarray(0, 32).includes(Buffer.from('ftyp'));
}

export function assertFullEpisodeClosure(result: FullEpisodeClosure): void {
  const episodeShots = result.episode.scenes.flatMap(scene => scene.shots);
  const producedShotIds = new Set(result.shots.map(item => item.shot_id));
  if (!episodeShots.length || episodeShots.some(shot => !shot.active_video_asset_id || !producedShotIds.has(shot.id))) {
    throw new Error('Not every episode shot has a generated video');
  }
  if (result.shots.some(item => item.panel.bytes < 10_000 || item.video.bytes < 100_000)) {
    throw new Error('One or more shot media assets are invalid');
  }
  const dialogueIds=episodeShots.flatMap(shot=>shot.dialogue.filter(line=>line.text.trim()).map(line=>line.id));
  const speechByDialogue=new Map(result.speech.map(item=>[item.dialogue_id,item.asset.bytes]));
  if(dialogueIds.some(id=>(speechByDialogue.get(id)??0)<1_000))throw new Error('Not every dialogue line has generated speech');
  if (result.render.bytes < 100_000) throw new Error('Final episode render is invalid');
  if (!result.render.review.overall_pass) throw new Error('Render quality review did not pass');
  if (!result.release.candidate.id) throw new Error('Release candidate was not persisted');
  if (!result.release.gate.ready) throw new Error('Release gate did not pass');
  if (!result.release.publication.id || result.release.publication.status !== 'published') {
    throw new Error('Publication record was not persisted');
  }
}

export function buildFullEpisodeExecutionPlan(episode: {scenes: Array<{shots: Array<{id: string; dialogue: Array<{id: string; text: string}>}>}>}): {shotIds: string[]; dialogueIds: string[]} {
  const shots=episode.scenes.flatMap(scene=>scene.shots);
  return {
    shotIds:shots.map(shot=>shot.id),
    dialogueIds:shots.flatMap(shot=>shot.dialogue.filter(line=>line.text.trim()).map(line=>line.id)),
  };
}

async function pollJob(
  request: APIRequestContext,
  jobId: string,
  deadline: number,
  label: string,
): Promise<Job> {
  let attempt = 0;
  while (Date.now() < deadline) {
    const job = await responseJson<Job>(
      await request.get(`/api/jobs/${jobId}`, {timeout: 30_000}),
      `${label} job`,
    );
    if (job.status === 'succeeded') return job;
    if (job.status === 'failed') throw new Error(`${label} job failed: ${job.error || 'unknown provider error'}`);
    attempt += 1;
    await wait(attempt <= 10 ? 1000 : 3000);
  }
  throw new Error(`${label} job timed out`);
}

async function mediaBody(request: APIRequestContext, asset: Asset, label: string): Promise<Buffer> {
  const response = await request.get(asset.media_url, {timeout: 120_000});
  if (!response.ok()) throw new Error(`${label} media failed with HTTP ${response.status()}`);
  return response.body();
}

async function parseImportWithRetries(
  request: APIRequestContext,
  importId: string,
  timeoutMs: number,
  onStage?: (stage: string) => void,
): Promise<ScriptImport> {
  const maxAttempts = Number(process.env.AI_COMIC_E2E_PARSE_ATTEMPTS ?? 3);
  let lastError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    onStage?.(`ai-structure-parse-attempt-${attempt}`);
    const action = attempt === 1 ? 'parse' : 'retry';
    const response = await request.post(`/api/script-imports/${importId}/${action}`, {
      timeout: Math.min(timeoutMs, 10 * 60 * 1000),
    });
    if (response.ok()) return response.json() as Promise<ScriptImport>;

    const current = await responseJson<ScriptImport>(
      await request.get(`/api/script-imports/${importId}`, {timeout: 30_000}),
      'Load failed script import',
    );
    if (current.status === 'ready' && current.structured_draft) return current;
    lastError = current.error || `HTTP ${response.status()}`;
    if (attempt < maxAttempts) await wait(1000);
  }
  throw new Error(`AI structure parsing failed after ${maxAttempts} attempts: ${lastError.slice(0, 1000)}`);
}

export async function runThemeToVideoPipeline({request, theme, timeoutMs, onStage}: PipelineInput): Promise<ThemeToVideoResult> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const timings: Record<string, number> = {};
  const stage = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
    onStage?.(name);
    const started = Date.now();
    const result = await action();
    timings[name] = Date.now() - started;
    return result;
  };

  await stage('provider-configuration', async () => {
    const channels = await responseJson<Record<string, {enabled: boolean; model: string; base_url: string}>>(
      await request.get('/api/provider-channels', {timeout: 30_000}),
      'Provider channels',
    );
    for (const kind of ['llm', 'image', 'video'] as const) {
      const channel = channels[kind];
      if (!channel?.enabled || !channel.model || !channel.base_url) {
        throw new Error(`${kind} provider channel is not configured`);
      }
    }
  });

  const unique = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const project = await stage('create-project', async () => responseJson<Project>(
    await request.post('/api/projects', {
      data: {
        title: `E2E AI 漫剧 ${unique}`,
        logline: theme,
        story_bible: `测试主题：${theme}\n只生成一集，使用一到两个场景和三到五个连续镜头，包含两句推动剧情的简短对白，保持角色、空间和光线连续。`,
        visual_style: '现代国风悬疑动态漫画，电影级光影，角色外观稳定，竖屏构图',
        aspect_ratio: '9:16',
        language: 'Chinese',
      },
      timeout: 30_000,
    }),
    'Create project',
  ));

  const scriptText = await stage('ai-script-stream', async () => {
    const response = await request.post(`/api/projects/${project.id}/script-generation/stream`, {
      data: {brief: theme, existing_draft: ''},
      timeout: Math.min(timeoutMs, 10 * 60 * 1000),
    });
    if (!response.ok()) throw new Error(`Script stream failed with HTTP ${response.status()}`);
    return parseScriptSse(await response.text());
  });

  const scriptImport = await stage('create-script-import', async () => responseJson<JsonObject & {id: string}>(
    await request.post(`/api/projects/${project.id}/script-imports`, {
      data: {mode: 'auto', text: scriptText},
      timeout: 30_000,
    }),
    'Create script import',
  ));

  const parsedImport = await stage(
    'ai-structure-parse',
    () => parseImportWithRetries(request, scriptImport.id, timeoutMs, onStage),
  );
  const draft = parsedImport.structured_draft;
  if (!draft?.episodes?.length) throw new Error('AI structure parser returned no episodes');

  await stage('confirm-ai-structure', async () => responseJson<JsonObject>(
    await request.post(`/api/script-imports/${scriptImport.id}/confirm`, {
      data: {character_mappings: {}},
      timeout: 30_000,
    }),
    'Confirm script import',
  ));

  const projectDetail = await stage('load-generated-structure', async () => responseJson<JsonObject & {
    characters: Character[];
    episodes: Array<{id: string}>;
  }>(
    await request.get(`/api/projects/${project.id}`, {timeout: 30_000}),
    'Load generated project',
  ));
  const episodeId = projectDetail.episodes[0]?.id;
  if (!episodeId) throw new Error('Confirmed AI structure created no episode');
  let episode = await responseJson<Episode>(
    await request.get(`/api/episodes/${episodeId}`, {timeout: 30_000}),
    'Load generated episode',
  );
  const executionPlan=buildFullEpisodeExecutionPlan(episode);
  if (!executionPlan.shotIds.length) throw new Error('Confirmed AI structure created no shot');

  await stage('generate-ai-character-references', async () => {
    for (const character of projectDetail.characters) {
      onStage?.(`generate-character-reference:${character.name}`);
      const reference = await responseJson<JsonObject & {id: string; asset: Asset}>(
        await request.post(`/api/characters/${character.id}/references/generate`, {
          data: {reference_type: 'primary', label: 'E2E AI 主参考'},
          timeout: Math.min(timeoutMs, 10 * 60 * 1000),
        }),
        `Generate reference for ${character.name}`,
      );
      const referenceBytes = await mediaBody(request, reference.asset, `Character reference for ${character.name}`);
      if (referenceBytes.length < 10_000 || !hasImageSignature(referenceBytes)) {
        throw new Error(`Character reference for ${character.name} is invalid (${referenceBytes.length} bytes)`);
      }
      await responseJson<JsonObject>(
        await request.patch(`/api/character-references/${reference.id}`, {
          data: {review_status: 'approved'},
          timeout: 30_000,
        }),
        `Approve reference for ${character.name}`,
      );
      await responseJson<JsonObject>(
        await request.put(`/api/characters/${character.id}/references/${reference.id}/active`, {
          timeout: 30_000,
        }),
        `Activate reference for ${character.name}`,
      );
    }
  });

  const generatedPanels=new Map<string,Asset&{bytes:number}>();
  for(const shot of episode.scenes.flatMap(scene=>scene.shots)){
    const panelJob=await stage(`start-ai-panel:${shot.id}`,async()=>responseJson<{job_id:string}>(
      await request.post(`/api/shots/${shot.id}/panels?activate=true`,{timeout:30_000}),
      `Start panel generation for shot ${shot.position}`,
    ));
    const finishedPanelJob=await stage(`wait-ai-panel:${shot.id}`,()=>pollJob(request,panelJob.job_id,deadline,`Panel generation for shot ${shot.position}`));
    const panelId=String(finishedPanelJob.result_metadata.asset_id??'');
    if(!panelId)throw new Error(`Panel generation for shot ${shot.position} returned no asset_id`);
    const panel=await responseJson<Asset>(await request.get(`/api/assets/${panelId}`,{timeout:30_000}),`Load panel asset for shot ${shot.position}`);
    const panelBytes=await stage(`verify-ai-panel:${shot.id}`,()=>mediaBody(request,panel,`Panel for shot ${shot.position}`));
    if(panelBytes.length<10_000||!hasImageSignature(panelBytes))throw new Error(`Panel for shot ${shot.position} is invalid (${panelBytes.length} bytes)`);

    const approvedShot=await stage(`approve-panel:${shot.id}`,async()=>responseJson<Shot>(
      await request.patch(`/api/shots/${shot.id}`,{data:{review_status:'approved',video_prompt:`${shot.composition}。保持角色外观、场景空间、光线方向和首帧构图稳定，动作自然连续。`,negative_video_prompt:'闪烁、变形、额外肢体、镜头抖动、角色换脸、字幕、水印'},timeout:30_000}),
      `Approve panel for shot ${shot.position}`,
    ));
    if(!approvedShot.active_panel_asset_id)throw new Error(`Approved shot ${shot.position} lost its active panel`);
    generatedPanels.set(shot.id,{...panel,bytes:panelBytes.length});
  }

  const speech:ThemeToVideoResult['speech']=[];
  for(const dialogueId of executionPlan.dialogueIds){
    const speechJob=await stage(`start-speech:${dialogueId}`,async()=>responseJson<{job_id:string}>(
      await request.post(`/api/dialogue/${dialogueId}/speech`,{timeout:30_000}),
      `Start speech generation for ${dialogueId}`,
    ));
    const finishedSpeechJob=await stage(`wait-speech:${dialogueId}`,()=>pollJob(request,speechJob.job_id,deadline,`Speech generation for ${dialogueId}`));
    const assetId=String(finishedSpeechJob.result_metadata.asset_id??'');
    if(!assetId)throw new Error(`Speech generation for ${dialogueId} returned no asset_id`);
    const asset=await responseJson<Asset>(await request.get(`/api/assets/${assetId}`,{timeout:30_000}),`Load speech asset for ${dialogueId}`);
    const bytes=await stage(`verify-speech:${dialogueId}`,()=>mediaBody(request,asset,`Speech for ${dialogueId}`));
    if(bytes.length<1_000)throw new Error(`Speech for ${dialogueId} is invalid (${bytes.length} bytes)`);
    speech.push({dialogue_id:dialogueId,asset:{...asset,bytes:bytes.length}});
  }

  const generatedShots:ThemeToVideoResult['shots']=[];
  for(const shot of episode.scenes.flatMap(scene=>scene.shots)){
    const panel=generatedPanels.get(shot.id);
    if(!panel)throw new Error(`Approved panel for shot ${shot.position} is missing`);
    const videoJob=await stage(`start-wan-video:${shot.id}`,async()=>responseJson<{job_id:string}>(
      await request.post(`/api/shots/${shot.id}/videos?activate=true`,{timeout:30_000}),
      `Start video generation for shot ${shot.position}`,
    ));
    const finishedVideoJob=await stage(`wait-wan-video:${shot.id}`,()=>pollJob(request,videoJob.job_id,deadline,`Video generation for shot ${shot.position}`));
    const videoId=String(finishedVideoJob.result_metadata.asset_id??'');
    if(!videoId)throw new Error(`Video generation for shot ${shot.position} returned no asset_id`);
    const video=await responseJson<Asset>(await request.get(`/api/assets/${videoId}`,{timeout:30_000}),`Load video asset for shot ${shot.position}`);
    const videoBytes=await stage(`verify-wan-video:${shot.id}`,()=>mediaBody(request,video,`Video for shot ${shot.position}`));
    if(videoBytes.length<100_000||!hasMp4Signature(videoBytes))throw new Error(`Video for shot ${shot.position} is invalid (${videoBytes.length} bytes)`);
    generatedShots.push({shot_id:shot.id,panel,video:{...video,bytes:videoBytes.length}});
  }

  episode = await responseJson<Episode>(
    await request.get(`/api/episodes/${episodeId}`, {timeout: 30_000}),
    'Reload generated episode',
  );
  const finalShots=episode.scenes.flatMap(scene=>scene.shots);
  if(finalShots.some(item=>!item.active_video_asset_id))throw new Error('One or more generated videos were not activated');

  const renderJob=await stage('start-episode-render',async()=>responseJson<{job_id:string}>(
    await request.post(`/api/episodes/${episodeId}/render`,{timeout:30_000}),
    'Start episode render',
  ));
  const finishedRenderJob=await stage('wait-episode-render',()=>pollJob(request,renderJob.job_id,deadline,'Episode render'));
  const renderPath=String(finishedRenderJob.result_metadata.output_path??'');
  const renderMediaUrl=String(finishedRenderJob.result_metadata.media_url??'');
  const review=finishedRenderJob.result_metadata.review as JsonObject & {overall_pass?:boolean};
  if(!renderPath||!renderMediaUrl)throw new Error('Episode render returned no output path');
  const renderResponse=await request.get(renderMediaUrl,{timeout:120_000});
  if(!renderResponse.ok())throw new Error(`Episode render media failed with HTTP ${renderResponse.status()}`);
  const renderBytes=await renderResponse.body();
  if(renderBytes.length<100_000||!hasMp4Signature(renderBytes))throw new Error(`Episode render is not a valid MP4 (${renderBytes.length} bytes)`);
  if(review?.overall_pass!==true)throw new Error('Episode render quality review did not pass');

  const candidate=await stage('create-release-candidate',async()=>responseJson<JsonObject&{id:string;status:string}>(
    await request.post(`/api/episodes/${episodeId}/release-candidates`,{data:{version:'V1',render_path:renderPath,qc_snapshot:review},timeout:30_000}),
    'Create release candidate',
  ));
  const gate=await stage('check-release-gate',async()=>responseJson<JsonObject&{ready:boolean}>(
    await request.get(`/api/release-candidates/${candidate.id}/gate`,{timeout:30_000}),
    'Check release gate',
  ));
  if(!gate.ready)throw new Error('Release gate did not pass');
  await stage('approve-release-candidate',async()=>responseJson<JsonObject>(
    await request.post(`/api/release-candidates/${candidate.id}/approve`,{timeout:30_000}),
    'Approve release candidate',
  ));
  const publication=await stage('publish-internal-master',async()=>responseJson<JsonObject&{id:string;status:string}>(
    await request.post(`/api/release-candidates/${candidate.id}/publish`,{data:{platform:'internal_master',idempotency_key:`${episodeId}:${candidate.id}:internal_master`},timeout:30_000}),
    'Publish internal master',
  ));

  timings.total = Date.now() - startedAt;
  const result:ThemeToVideoResult={
    theme,
    project,
    episode,
    shot: finalShots[0],
    script: {characters: draft.characters.length, episodes: draft.episodes.length, bytes: Buffer.byteLength(scriptText)},
    panel:generatedShots[0].panel,
    video:generatedShots[0].video,
    shots:generatedShots,
    speech,
    render:{path:renderPath,media_url:renderMediaUrl,bytes:renderBytes.length,review:{...review,overall_pass:true}},
    release:{candidate,gate,publication},
    timings_ms: timings,
  };
  assertFullEpisodeClosure(result);
  return result;
}
