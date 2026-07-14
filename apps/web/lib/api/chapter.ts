// M1.1 chapter event graph API client.

import { apiRequest, json } from './core';
import type {
  ChapterExtractResponse,
  ChapterListResponse,
} from '../types/chapter';

export const listChapters = (scriptDocumentId: string) =>
  apiRequest<ChapterListResponse>(`/api/scripts/${scriptDocumentId}/chapters`);

export const reextractChapters = (scriptDocumentId: string) =>
  apiRequest<ChapterListResponse>(
    `/api/scripts/${scriptDocumentId}/chapters/reextract`,
    json('POST', { force: true }),
  );

export const extractChapterEvents = (
  scriptDocumentId: string,
  body: { chapter_ids?: string[]; project_context?: Record<string, unknown> } = {},
) =>
  apiRequest<ChapterExtractResponse>(
    `/api/scripts/${scriptDocumentId}/chapters/extract-events`,
    json('POST', body),
  );

export const episodeChapterEvents = (episodeId: string) =>
  apiRequest<ChapterListResponse>(`/api/episodes/${episodeId}/chapter-events`);
