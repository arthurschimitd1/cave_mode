import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cave — uma tarefa de cada vez',
  description: 'Organize seu tempo, construa sua evolução.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#101014',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
