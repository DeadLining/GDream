import {afterEach,describe,expect,it,vi} from 'vitest';
import {captureDirectorPreview} from '../lib/director-preview';

describe('captureDirectorPreview',()=>{
  afterEach(()=>vi.restoreAllMocks());
  it('bounds the output and returns a PNG blob for nonblank pixels',async()=>{
    const pixels=new Uint8ClampedArray([0,0,0,255,120,80,40,255]);
    const context={drawImage:vi.fn(),getImageData:vi.fn(()=>({data:pixels}))};
    const target={width:0,height:0,getContext:vi.fn(()=>context),toBlob:(callback:(blob:Blob|null)=>void)=>callback(new Blob(['png'],{type:'image/png'}))};
    vi.spyOn(document,'createElement').mockReturnValue(target as unknown as HTMLCanvasElement);
    const blob=await captureDirectorPreview({width:3200,height:1800} as HTMLCanvasElement);
    expect(target.width).toBe(1600);expect(target.height).toBe(900);expect(context.drawImage).toHaveBeenCalled();expect(blob.type).toBe('image/png');
  });
  it('rejects an all-background preview',async()=>{
    const context={drawImage:vi.fn(),getImageData:vi.fn(()=>({data:new Uint8ClampedArray([20,20,20,255,20,20,20,255])}))};
    const target={width:0,height:0,getContext:vi.fn(()=>context),toBlob:vi.fn()};
    vi.spyOn(document,'createElement').mockReturnValue(target as unknown as HTMLCanvasElement);
    await expect(captureDirectorPreview({width:800,height:600} as HTMLCanvasElement)).rejects.toThrow('preview_is_blank');
  });
});
