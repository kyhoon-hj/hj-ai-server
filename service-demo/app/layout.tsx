import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'HJ Mart Assist',
  description: '고객 문의부터 매장 운영까지 연결하는 HJ AI Server 서비스 데모',
  openGraph: {
    title: 'HJ Mart Assist',
    description: '고객 문의부터 매장 운영까지 연결하는 HJ AI Server 서비스 데모',
    images: [{ url: '/service-demo-og.png', width: 1200, height: 630 }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
