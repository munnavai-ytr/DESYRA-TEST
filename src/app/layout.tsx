import type { Metadata } from 'next';
import { Inter, Space_Grotesk, Hind_Siliguri, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Header } from '@/components/layout/header';
import { ToastProvider } from '@/components/ui/toast';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const hindSiliguri = Hind_Siliguri({
  weight: ['400', '500', '600', '700'],
  subsets: ['bengali', 'latin'],
  variable: '--font-hind-siliguri',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'DESYRA - Premium AI App Builder',
  description: 'Describe your idea. DESYRA designs and builds it.',
  openGraph: {
    title: 'DESYRA - Premium AI App Builder',
    description: 'Describe your idea. DESYRA designs and builds it.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DESYRA - Premium AI App Builder',
    description: 'Describe your idea. DESYRA designs and builds it.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${hindSiliguri.variable} ${jetbrainsMono.variable} dark`}
    >
      <body className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans antialiased flex flex-col selection:bg-[var(--accent)]/30 selection:text-white" suppressHydrationWarning>
        <ToastProvider>
          <Header />
          <main className="flex-1 flex flex-col">{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}
