import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Hanken_Grotesk } from 'next/font/google';
import './globals.css';

const grotesk = Hanken_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-grotesk', display: 'swap' });

export const metadata: Metadata = {
  title: 'DevLens',
  description: 'Replay a consented AI coding session as evidence. No score, no verdict.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={grotesk.variable}>
      <body>{children}</body>
    </html>
  );
}
