import type {Metadata} from 'next';
import './globals.css';

export const metadata: Metadata = {title: 'AI 漫剧工坊', description: '本地动态漫画制作工作台'};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
