import {z} from 'zod';

const dialogueSchema = z.object({
  id: z.string().min(1),
  characterName: z.string().min(1),
  text: z.string().min(1),
  startSeconds: z.number().min(0),
  durationSeconds: z.number().positive(),
  audioPath: z.string().min(1).optional(),
});

const shotSchema = z.object({
  id: z.string().min(1),
  durationSeconds: z.number().positive().max(60),
  panelPath: z.string().min(1),
  videoPath: z.string().min(1).optional(),
  videoDurationSeconds: z.number().positive().optional(),
  reviewStatus: z.literal('approved'),
  motion: z.enum(['push_in', 'pull_out', 'pan_left', 'pan_right', 'still']),
  dialogue: z.array(dialogueSchema),
});

export const manifestSchema = z.object({
  episode: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().min(24).max(60),
  }),
  shots: z.array(shotSchema).min(1),
});

export type RenderManifest = z.infer<typeof manifestSchema>;

export const parseManifest = (value: unknown): RenderManifest =>
  manifestSchema.parse(value);

export const durationInFrames = (manifest: RenderManifest): number =>
  Math.ceil(
    manifest.shots.reduce((total, shot) => total + shot.durationSeconds, 0) *
      manifest.episode.fps,
  );
