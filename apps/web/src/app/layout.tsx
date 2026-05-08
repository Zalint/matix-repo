import type { Metadata } from 'next';
import './globals.css';
import { TenantProvider } from '@/lib/tenant-context';

export const metadata: Metadata = {
  title: 'Matix',
  description: 'Suite SaaS B2B modulaire',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <TenantProvider>{children}</TenantProvider>
      </body>
    </html>
  );
}
