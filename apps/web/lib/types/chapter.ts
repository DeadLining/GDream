// Types for M1.1 chapter event graph.
// Chapters are deterministic slices of a script document; event summaries
// are populated by LLM extraction on demand.

export type ChapterExtractionStatus = 'pending' | 'extracted' | 'failed' | 'skipped';

export type ChapterBeat = {
  order: number;
  summary: string;
  characters: string[];
  stakes: string;
};

export type ChapterEventSummary = {
  chapter_index?: number;
  title?: string | null;
  beats?: ChapterBeat[];
  conflicts?: string[];
  open_threads?: string[];
  payoff_candidates?: string[];
  character_mentions?: string[];
};

export type ScriptChapter = {
  id: string;
  chapter_index: number;
  title: string | null;
  source_text: string;
  event_summary: ChapterEventSummary;
  character_ids: string[];
  scene_ids: string[];
  extraction_status: ChapterExtractionStatus;
  extraction_error: string;
  created_at: string | null;
  updated_at: string | null;
};

export type ChapterListResponse = {
  script_document_id: string;
  chapters: ScriptChapter[];
};

export type ChapterExtractResponse = {
  extracted: ScriptChapter[];
  failed: Array<{ chapter_id: string; chapter_index: number; error: string; code?: string }>;
};
