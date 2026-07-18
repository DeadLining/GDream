import {beforeEach,describe,expect,it} from 'vitest';
import {markProjectAccess,orderRecentlyAccessedProjects} from '../lib/recent-projects';
import type {Project} from '../lib/types';

const project=(id:string,updatedAt:string):Project=>({
  id,
  title:id,
  logline:'',
  story_bible:'',
  visual_style:'',
  aspect_ratio:'16:9',
  language:'Chinese',
  created_at:'2026-07-01T00:00:00Z',
  updated_at:updatedAt,
});

describe('recent project access history',()=>{
  beforeEach(()=>localStorage.clear());

  it('orders projects by access instead of content modification time',()=>{
    const projects=[
      project('newly-edited','2026-07-18T12:00:00Z'),
      project('recently-opened','2026-07-01T12:00:00Z'),
    ];

    markProjectAccess('recently-opened');

    expect(orderRecentlyAccessedProjects(projects).map(item=>item.id)).toEqual([
      'recently-opened',
      'newly-edited',
    ]);
  });

  it('deduplicates accesses and returns at most five existing projects',()=>{
    const projects=Array.from({length:7},(_,index)=>project(`p${index+1}`,`2026-07-0${index+1}T12:00:00Z`));
    ['missing','p1','p2','p3','p4','p5','p6','p2'].forEach(markProjectAccess);

    expect(orderRecentlyAccessedProjects(projects).map(item=>item.id)).toEqual([
      'p2','p6','p5','p4','p3',
    ]);
  });
});
