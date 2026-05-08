import { getTranslations } from 'next-intl/server';
import { signIn } from '@/auth';
import { Button } from '@/components/ui/button';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const t = await getTranslations('auth');

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-50 to-brand-100 p-6">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-brand-600 font-bold text-white">M</div>
          <div>
            <h1 className="text-2xl font-semibold">{t('login_title')}</h1>
            <p className="text-sm text-gray-500">{t('login_subtitle')}</p>
          </div>
        </div>

        <p className="mb-6 text-sm text-gray-600">{t('login_intro')}</p>

        <form
          action={async () => {
            'use server';
            const { callbackUrl } = await searchParams;
            await signIn('keycloak', { redirectTo: callbackUrl ?? '/dashboard' });
          }}
        >
          <Button type="submit" className="w-full">
            {t('login_button')}
          </Button>
        </form>

        <p className="mt-6 text-xs text-gray-400">{t('login_no_account')}</p>
      </div>
    </div>
  );
}
