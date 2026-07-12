import path from 'node:path';
import type {NextConfig} from 'next';

const apiProxyTarget = process.env.AI_COMIC_API_PROXY_TARGET ?? 'http://127.0.0.1:8000';

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(process.cwd(), '../..'),
  },
  async rewrites() {
    return [
      {source: '/api/:path*', destination: `${apiProxyTarget}/api/:path*`},
      {source: '/media/:path*', destination: `${apiProxyTarget}/media/:path*`},
    ];
  },
};

export default nextConfig;
