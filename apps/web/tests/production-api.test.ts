import {afterEach,describe,expect,it,vi} from 'vitest';
import {createProductionRun} from '../lib/api';
import {pollProductionRun} from '../lib/production';
import type {ProductionRun} from '../lib/types';

const run=(status:ProductionRun['status']):ProductionRun=>({id:'run-1',episode_id:'ep-1',status,stages:['panels'],concurrency:2,regenerate_panels:false,regenerate_speech:false,pause_requested:status==='paused',total_items:2,queued_items:status==='running'?1:0,running_items:status==='running'?1:0,succeeded_items:status==='completed'?2:0,failed_items:0,skipped_items:0,summary_error:'',created_at:'',updated_at:''});

describe('production API',()=>{
 afterEach(()=>vi.unstubAllGlobals());
 it('sends strict batch options',async()=>{const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify(run('queued')),{status:202,headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetchMock);await createProductionRun('ep-1',{stages:['panels','speech'],concurrency:3,regenerate_panels:false,regenerate_speech:true});expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({stages:['panels','speech'],concurrency:3,regenerate_panels:false,regenerate_speech:true});});
 it('polls while active and stops when paused',async()=>{const loadRun=vi.fn().mockResolvedValueOnce(run('running')).mockResolvedValueOnce(run('paused'));const sleep=vi.fn().mockResolvedValue(undefined);const result=await pollProductionRun('run-1',{loadRun,sleep});expect(result.status).toBe('paused');expect(loadRun).toHaveBeenCalledTimes(2);});
 it('supports abort cancellation',async()=>{const controller=new AbortController();controller.abort();await expect(pollProductionRun('run-1',{loadRun:async()=>run('running'),signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});});
});
