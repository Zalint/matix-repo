import { LocaleSwitcher } from '@/components/locale-switcher';
import { Sidebar } from '@/components/sidebar';
import { TenantSwitcher } from '@/components/tenant-switcher';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
          <h1 className="text-sm text-gray-500">Phase 0 — POC multi-tenant</h1>
          <div className="flex items-center gap-3">
            <LocaleSwitcher />
            <TenantSwitcher />
          </div>
        </header>
        <main className="flex-1 overflow-auto bg-gray-50 p-6">{children}</main>
      </div>
    </div>
  );
}
