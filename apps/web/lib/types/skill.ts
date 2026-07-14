// M2.1 Skill file management — types.

export type SkillSource = 'disk' | 'default';

export type SkillSummary = {
  name: string;
  source: SkillSource;
  /** ISO timestamp from file mtime when on disk; null for default. */
  updated_at: string | null;
};

export type SkillRead = SkillSummary & {
  body: string;
};

export type SkillWrite = {
  body: string;
};
