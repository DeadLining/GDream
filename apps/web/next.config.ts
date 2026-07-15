import path from 'node:path';
import type {NextConfig} from 'next';

const apiProxyTarget = process.env.AI_COMIC_API_PROXY_TARGET ?? 'http://127.0.0.1:8000';
const comfyUiProxyTarget = process.env.AI_COMIC_COMFYUI_PROXY_TARGET ?? 'http://127.0.0.1:7898';

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(process.cwd(), '../..'),
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/:path*',
          has: [{type: 'host', value: 'comfyui.localhost'}],
          destination: `${comfyUiProxyTarget}/:path*`,
        },
      ],
      afterFiles: [
        {source: '/api/:path*', destination: `${apiProxyTarget}/api/:path*`},
        {source: '/media/:path*', destination: `${apiProxyTarget}/media/:path*`},
      ],
      fallback: [],
    };
  },
};

export default nextConfig;
