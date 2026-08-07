import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Fiscaliza AI', template: '%s | Fiscaliza AI' },
  description: 'Fiscalização legislativa estruturada, segura e auditável.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
