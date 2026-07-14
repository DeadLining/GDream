import {useState} from 'react';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {DialogueEditor} from '../components/DialogueEditor';
import type {Character,DialogueLine,Job} from '../lib/types';

const mocks=vi.hoisted(()=>({updateDialogue:vi.fn(),startSpeech:vi.fn(),pollJob:vi.fn()}));
vi.mock('../lib/api',()=>({updateDialogue:mocks.updateDialogue,startSpeech:mocks.startSpeech,mediaUrl:(path:string)=>path}));
vi.mock('../lib/jobs',()=>({pollJob:mocks.pollJob}));

const line:DialogueLine={id:'line-1',character_id:'character-1',position:1,text:'别回头。',subtitle_text:'别回头。',emotion:'tense',performance_instruction:'低声',audio_asset_id:null,start_seconds:0,duration_seconds:0};
const character:Character={id:'character-1',project_id:'project-1',name:'林默',role:'protagonist',appearance_bible:'black coat',personality:'quiet',continuity_rules:'',negative_constraints:'',voice_speaker:'Dylan',voice_instruction:'',created_at:'',updated_at:''};
const succeeded:Job={id:'job-1',operation:'speech',target_type:'dialogue',target_id:'line-1',status:'succeeded',progress:100,result_metadata:{media_url:'/media/line-1.wav'},error:'',retry_count:0,created_at:'',updated_at:''};

function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(reason?:unknown)=>void;const promise=new Promise<T>((nextResolve,nextReject)=>{resolve=nextResolve;reject=nextReject;});return {promise,resolve,reject};}

describe('DialogueEditor',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.startSpeech.mockResolvedValue({job_id:'job-1',status:'queued'});mocks.pollJob.mockResolvedValue(succeeded);});
  afterEach(cleanup);

  it('saves current dialogue fields before starting speech',async()=>{
    const saved={...line,text:'快走。',emotion:'urgent'};const onLineUpdated=vi.fn();
    mocks.updateDialogue.mockResolvedValue(saved);
    render(<DialogueEditor line={line} characters={[character]} onLineUpdated={onLineUpdated}/>);
    await userEvent.clear(screen.getByLabelText('对白文本'));await userEvent.type(screen.getByLabelText('对白文本'),'快走。');
    await userEvent.clear(screen.getByLabelText('情绪'));await userEvent.type(screen.getByLabelText('情绪'),'urgent');

    await userEvent.click(screen.getByRole('button',{name:'生成配音'}));

    await waitFor(()=>expect(mocks.startSpeech).toHaveBeenCalledWith('line-1'));
    expect(mocks.updateDialogue).toHaveBeenCalledWith('line-1',expect.objectContaining({character_id:'character-1',text:'快走。',emotion:'urgent'}));
    expect(mocks.updateDialogue.mock.invocationCallOrder[0]).toBeLessThan(mocks.startSpeech.mock.invocationCallOrder[0]);
    expect(onLineUpdated).toHaveBeenCalledWith(saved);
    expect(await screen.findByLabelText('对白音频')).toHaveAttribute('src','/media/line-1.wav');
  });

  it('does not start speech when saving the dialogue fails',async()=>{
    mocks.updateDialogue.mockRejectedValue(new Error('对白保存失败'));
    render(<DialogueEditor line={line} characters={[character]}/>);

    await userEvent.click(screen.getByRole('button',{name:'生成配音'}));

    expect(await screen.findByRole('alert')).toHaveTextContent('对白保存失败');
    expect(mocks.startSpeech).not.toHaveBeenCalled();
    expect(screen.getByRole('button',{name:'生成配音'})).toBeEnabled();
  });

  it('shows save progress and prevents duplicate submissions',async()=>{
    const pending=deferred<DialogueLine>();mocks.updateDialogue.mockReturnValue(pending.promise);
    render(<DialogueEditor line={line} characters={[character]}/>);

    await userEvent.click(screen.getByRole('button',{name:'保存对白'}));

    expect(screen.getByRole('button',{name:'保存中'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'生成配音'})).toBeDisabled();
    expect(mocks.updateDialogue).toHaveBeenCalledTimes(1);
    pending.resolve(line);
    expect(await screen.findByText('对白已保存')).toBeVisible();
  });

  it('keeps the saved status visible after the parent accepts the updated line',async()=>{
    mocks.updateDialogue.mockResolvedValue({...line,text:'已保存对白'});
    function Harness(){const [current,setCurrent]=useState(line);return <DialogueEditor line={current} characters={[character]} onLineUpdated={setCurrent}/>;}
    render(<Harness/>);

    await userEvent.click(screen.getByRole('button',{name:'保存对白'}));

    expect(await screen.findByText('对白已保存')).toBeVisible();
  });
});
