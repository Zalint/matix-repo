import { signIn } from '@/auth';
import { Button } from '@/components/ui/button';

export default function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-50 to-brand-100 p-6">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-brand-600 font-bold text-white">M</div>
          <div>
            <h1 className="text-2xl font-semibold">Matix</h1>
            <p className="text-sm text-gray-500">Suite SaaS B2B</p>
          </div>
        </div>

        <p className="mb-6 text-sm text-gray-600">
          Connecte-toi avec ton compte Matix pour accéder à ton espace.
        </p>

        <form
          action={async () => {
            'use server';
            const { callbackUrl } = await searchParams;
            await signIn('keycloak', { redirectTo: callbackUrl ?? '/dashboard' });
          }}
        >
          <Button type="submit" className="w-full">
            Se connecter
          </Button>
        </form>

        <p className="mt-6 text-xs text-gray-400">
          Tu n'as pas encore de compte ? Demande à l'administrateur de ton organisation.
        </p>
      </div>
    </div>
  );
}
