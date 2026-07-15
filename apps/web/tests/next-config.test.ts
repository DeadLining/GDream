import {expect,it} from 'vitest';

import nextConfig from '../next.config';

it('proxies the ComfyUI host through the main web service',async()=>{
  const rewrites=await nextConfig.rewrites?.();

  expect(rewrites).toMatchObject({
    beforeFiles:[{
      source:'/:path*',
      has:[{type:'host',value:'comfyui.localhost'}],
      destination:'http://127.0.0.1:7898/:path*',
    }],
  });
});
