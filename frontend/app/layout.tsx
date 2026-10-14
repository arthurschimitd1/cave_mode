import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cave — uma tarefa de cada vez',
  description: 'Organize seu tempo, construa sua evolução.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icon-512.png', type: 'image/png', sizes: '512x512' }],
    apple: [{ url: '/icon-192.png', type: 'image/png', sizes: '192x192' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Cave',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  themeColor: '#101014',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
