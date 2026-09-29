import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'铁路足迹 — 我的火车行程簿',description:'沿真实铁路轨迹回放旅程，查看车站统计，导入并管理自己的乘车记录。',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN"><body>{children}</body></html>;}
