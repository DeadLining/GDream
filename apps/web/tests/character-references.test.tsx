import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {CharacterWorkspace} from '../components/CharacterWorkspace';

const mocks=vi.hoisted(()=>({list:vi.fn(),upload:vi.fn(),generate:vi.fn(),update:vi.fn(),activate:vi.fn()}));
vi.mock('../lib/api',()=>({listCharacterReferences:mocks.list,uploadCharacterReference:mocks.upload,generateCharacterReference:mocks.generate,updateCharacterReference:mocks.update,activateCharacterReference:mocks.activate,mediaUrl:(path:string)=>path}));
const character={id:'c1',project_id:'p1',name:'林夏',role:'主角',appearance_bible:'黑色风衣',personality:'冷静',continuity_rules:'银色耳钉',negative_constraints:'',voice_speaker:'v1',voice_instruction:'',created_at:'',updated_at:''};
const reference={id:'r1',character_id:'c1',reference_type:'primary' as const,label:'主参考',position:0,is_active:false,review_status:'draft' as const,created_at:'',asset:{id:'a1',kind:'character-reference',media_url:'/media/a.png',media_type:'image/png',provider:'upload',model:'local',generation_attempt:1,review_status:'draft',width:1,height:1,duration_seconds:null,created_at:''}};
beforeEach(()=>{vi.clearAllMocks();mocks.list.mockResolvedValue([reference]);mocks.update.mockResolvedValue({...reference,review_status:'approved'});mocks.activate.mockResolvedValue({...reference,review_status:'approved',is_active:true});mocks.generate.mockResolvedValue(reference);});afterEach(cleanup);
it('reviews and activates a character reference',async()=>{mocks.list.mockResolvedValueOnce([reference]).mockResolvedValue([{...reference,review_status:'approved'}]);const user=userEvent.setup();render(<CharacterWorkspace characters={[character]}/>);await user.click(await screen.findByRole('button',{name:/批准/}));await waitFor(()=>expect(mocks.update).toHaveBeenCalledWith('r1',{review_status:'approved'}));await user.click(await screen.findByRole('button',{name:'设为使用'}));expect(mocks.activate).toHaveBeenCalledWith('c1','r1');});
it('generates the selected reference type',async()=>{const user=userEvent.setup();render(<CharacterWorkspace characters={[character]}/>);await screen.findByText('主参考');await user.click(screen.getByRole('button',{name:'侧面'}));await user.click(screen.getByRole('button',{name:/生成/}));expect(mocks.generate).toHaveBeenCalledWith('c1','side');});
