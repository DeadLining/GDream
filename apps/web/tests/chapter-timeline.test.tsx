import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {ChapterTimeline} from '../components/ChapterTimeline';

const mocks=vi.hoisted(()=>({list:vi.fn(),extract:vi.fn(),reextract:vi.fn()}));

vi.mock('../lib/api/chapter',async importOriginal=>({
  ...await importOriginal<typeof import('../lib/api/chapter')>(),
  listChapters:mocks.list,
  extractChapterEvents:mocks.extract,
  reextractChapters:mocks.reextract,
}));

const chapter={
  id:'chapter-1',script_document_id:'script-1',chapter_index:0,title:'雨夜',
  source_text:'# 雨夜\n\n**林夏**发现一枚发光海螺。',event_summary:{},character_ids:[],scene_ids:[],
  extraction_status:'pending' as const,extraction_error:'',created_at:'',updated_at:'',
};

beforeEach(()=>{
  mocks.list.mockResolvedValue({script_document_id:'script-1',chapters:[chapter]});
  mocks.extract.mockResolvedValue({extracted:[{...chapter,extraction_status:'extracted'}],failed:[]});
  mocks.reextract.mockResolvedValue({script_document_id:'script-1',chapters:[chapter]});
});
afterEach(()=>{cleanup();vi.clearAllMocks();});

it('renders the original chapter fragment as markdown',async()=>{
  const user=userEvent.setup();
  render(<ChapterTimeline scriptDocumentId="script-1"/>);

  await user.click(await screen.findByRole('button',{name:/第 1 章/}));
  expect(screen.getByRole('heading',{name:'雨夜'})).toBeVisible();
  expect(screen.getByText('林夏',{selector:'strong'})).toBeVisible();
});

it('notifies the parent after extracting chapter events',async()=>{
  const user=userEvent.setup();
  const onExtractionComplete=vi.fn();
  render(<ChapterTimeline scriptDocumentId="script-1" onExtractionComplete={onExtractionComplete}/>);

  await user.click(await screen.findByRole('button',{name:'提取全部事件'}));

  expect(onExtractionComplete).toHaveBeenCalledTimes(1);
});
