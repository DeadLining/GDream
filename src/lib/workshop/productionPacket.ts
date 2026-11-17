import { videoInputFingerprint } from './productionLifecycle.ts';
import type { ShotContinuityMode, ShotProductionPacket } from './types.ts';

export interface ShotProductionPacketInput {
  projectId: string;
  shotNo: string;
  jobId?: string;
  productionRunId?: string;
  sourceScriptRevisionId?: string;
  model: string;
  engineId: string;
  prompt: string;
  referencePaths: string[];
  referenceLabels?: string[];
  referenceSignature?: string;
  audioPaths?: string[];
  videoPaths?: string[];
  params?: Record<string, unknown>;
  continuityMode?: ShotContinuityMode;
  previousTailPath?: string;
  startFramePath?: string;
  endFramePath?: string;
  actionTimeline?: ShotProductionPacket['actionTimeline'];
  entryState?: ShotProductionPacket['entryState'];
  exitState?: ShotProductionPacket['exitState'];
  continuitySnapshot?: ShotProductionPacket['continuitySnapshot'];
  createdAt?: number;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function normalizeShotProductionPacket(
  value: Partial<ShotProductionPacket> | null | undefined,
  fallback: { projectId?: string; shotNo?: string } = {},
): ShotProductionPacket | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const params = value.params && typeof value.params === 'object' && !Array.isArray(value.params)
    ? { ...value.params }
    : {};
  return {
    packetVersion: 1,
    projectId: typeof value.projectId === 'string' ? value.projectId : fallback.projectId ?? '',
    shotNo: typeof value.shotNo === 'string' ? value.shotNo : fallback.shotNo ?? '',
    jobId: typeof value.jobId === 'string' ? value.jobId : undefined,
    productionRunId: typeof value.productionRunId === 'string' ? value.productionRunId : undefined,
    sourceScriptRevisionId: typeof value.sourceScriptRevisionId === 'string' ? value.sourceScriptRevisionId : undefined,
    model: typeof value.model === 'string' ? value.model : '',
    engineId: typeof value.engineId === 'string' ? value.engineId : '',
    prompt: typeof value.prompt === 'string' ? value.prompt : '',
    referencePaths: stringArray(value.referencePaths),
    referenceLabels: stringArray(value.referenceLabels),
    ...(typeof value.referenceSignature === 'string' ? { referenceSignature: value.referenceSignature } : {}),
    audioPaths: stringArray(value.audioPaths),
    videoPaths: stringArray(value.videoPaths),
    params,
    continuityMode: value.continuityMode,
    previousTailPath: typeof value.previousTailPath === 'string' ? value.previousTailPath : undefined,
    startFramePath: typeof value.startFramePath === 'string' ? value.startFramePath : undefined,
    endFramePath: typeof value.endFramePath === 'string' ? value.endFramePath : undefined,
    ...(value.actionTimeline ? { actionTimeline: value.actionTimeline } : {}),
    ...(value.entryState ? { entryState: value.entryState } : {}),
    ...(value.exitState ? { exitState: value.exitState } : {}),
    ...(value.continuitySnapshot ? { continuitySnapshot: value.continuitySnapshot } : {}),
    inputFingerprint: typeof value.inputFingerprint === 'string' ? value.inputFingerprint : '',
    createdAt: typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : 0,
  };
}

export function buildShotProductionPacket(input: ShotProductionPacketInput): ShotProductionPacket {
  const referencePaths = [...input.referencePaths];
  const audioPaths = [...(input.audioPaths ?? [])];
  const videoPaths = [...(input.videoPaths ?? [])];
  const params = {
    ...(input.params ?? {}),
    ...(input.startFramePath ? { h3StartFramePath: input.startFramePath } : {}),
    ...(input.endFramePath ? { h3EndFramePath: input.endFramePath } : {}),
  };
  const inputFingerprint = videoInputFingerprint({
    engineId: input.engineId,
    prompt: input.prompt,
    referencePaths,
    audioPaths,
    videoPaths,
    params,
  });
  return {
    packetVersion: 1,
    projectId: input.projectId,
    shotNo: input.shotNo,
    jobId: input.jobId,
    productionRunId: input.productionRunId,
    sourceScriptRevisionId: input.sourceScriptRevisionId,
    model: input.model,
    engineId: input.engineId,
    prompt: input.prompt,
    referencePaths,
    referenceLabels: [...(input.referenceLabels ?? [])],
    ...(input.referenceSignature ? { referenceSignature: input.referenceSignature } : {}),
    audioPaths,
    videoPaths,
    params,
    continuityMode: input.continuityMode,
    previousTailPath: input.previousTailPath,
    startFramePath: input.startFramePath,
    endFramePath: input.endFramePath,
    actionTimeline: input.actionTimeline,
    entryState: input.entryState,
    exitState: input.exitState,
    continuitySnapshot: input.continuitySnapshot,
    inputFingerprint,
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function recoveredShotProductionPacket(input: {
  taskPacket?: ShotProductionPacket;
  latestShotPacket?: ShotProductionPacket;
  inputFingerprint?: string;
  jobId: string;
  productionRunId: string;
}): ShotProductionPacket | undefined {
  if (!input.inputFingerprint) return undefined;
  const matchingPacket = [input.taskPacket, input.latestShotPacket].find((packet) => (
    packet?.inputFingerprint === input.inputFingerprint
  ));
  if (!matchingPacket) return undefined;
  return {
    ...matchingPacket,
    jobId: input.jobId,
    productionRunId: input.productionRunId,
  };
}
