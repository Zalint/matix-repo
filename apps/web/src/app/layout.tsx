import type { Metadata } from 'next';
import './globals.css';
import { TenantProvider } from '@/lib/tenant-context';

export const metadata: Metadata = {
  title: 'Matix',
  description: 'Suite SaaS B2B modulaire',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning : neutralise les attributs injectés par les extensions
    // Chrome (Grammarly `data-new-gr-c-s-*`, LanguageTool `data-lt-installed`, etc.)
    // qui causent des hydration mismatches sans impact fonctionnel.
    <html lang="fr" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <TenantProvider>{children}</TenantProvider>
      </body>
    </html>
  );
}
