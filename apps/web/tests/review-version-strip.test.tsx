import {cleanup,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ReviewVersionStrip} from '../components/ReviewVersionStrip';

const mocks=vi.hoisted(()=>({list:vi.fn()}));
vi.mock('../lib/api',()=>({listPanelVersions:mocks.list,mediaUrl:(value:string)=>value}));

describe('ReviewVersionStrip',()=>{
  afterEach(()=>{cleanup();vi.clearAllMocks();});

  it('renders actual panel attempts and marks active and review candidate assets',async()=>{
    const onSelectAsset=vi.fn();
    mocks.list.mockResolvedValue([
      {id:'asset-3',generation_attempt:3,media_url:'/media/3.png'},
      {id:'asset-2',generation_attempt:2,media_url:'/media/2.png'},
      {id:'asset-1',generation_attempt:1,media_url:'/media/1.png'},
    ]);

    render(<ReviewVersionStrip shotId="shot-1" activeAssetId="asset-2" selectedAssetId="asset-2" candidateAssetIds={['asset-3']} onSelectAsset={onSelectAsset}/>);

    expect(await screen.findByRole('button',{name:'画面版本 V3，审阅候选'})).toBeVisible();
    expect(screen.getByRole('button',{name:'画面版本 V2，当前版本'})).toHaveAttribute('aria-pressed','true');
    expect(screen.getByText('3 个真实版本')).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'画面版本 V3，审阅候选'}));
    expect(onSelectAsset).toHaveBeenCalledWith(expect.objectContaining({id:'asset-3',media_url:'/media/3.png'}));
  });
});
