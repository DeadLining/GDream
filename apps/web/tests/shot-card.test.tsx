import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {ShotCard} from '../components/ShotCard';
import type {Asset, Shot} from '../lib/types';

const mocks = vi.hoisted(() => ({getAsset: vi.fn()}));
vi.mock('../lib/api', () => ({...mocks, mediaUrl: (path: string) => path}));

const shot: Shot = {
  id:'shot-1',position:1,shot_type:'wide_shot',duration_seconds:8,composition:'雨夜巷道',
  camera_motion:'push_in',character_state:{},image_prompt:'',negative_prompt:'',
  active_panel_asset_id:'asset-1',review_status:'draft',render_status:'pending',dialogue:[],
};
const asset: Asset = {
  id:'asset-1',kind:'panel',media_url:'/media/projects/project-1/panel.png',media_type:'image/png',
  provider:'openai',model:'gpt-image-2',generation_attempt:1,review_status:'draft',width:1024,
  height:1536,duration_seconds:null,created_at:'',
};

describe('ShotCard', () => {
  it('shows the active panel asset instead of a demo image', async () => {
    mocks.getAsset.mockResolvedValue(asset);

    render(<ShotCard shot={shot} selected={false} onSelect={vi.fn()}/>);

    expect(await screen.findByRole('img')).toHaveAttribute('src',asset.media_url);
    expect(mocks.getAsset).toHaveBeenCalledWith('asset-1');
  });
});
