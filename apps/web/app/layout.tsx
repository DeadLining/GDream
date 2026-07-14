import type {Metadata} from 'next';
import {Inter, Noto_Sans_SC} from 'next/font/google';
import './globals.css';
import '@xyflow/react/dist/style.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const notoSansSC = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-noto-sans-sc',
  preload: false,
});

export const metadata: Metadata = {title: 'AI 漫剧工坊', description: '本地动态漫画制作工作台'};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="zh-CN" className={`${inter.variable} ${notoSansSC.variable}`}>
      <body>{children}</body>
    </html>
  );
}
