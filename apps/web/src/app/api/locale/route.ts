import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE_NAME, isLocale } from '@/i18n/config';

/**
 * POST /api/locale  body: { locale: 'fr' | 'en' }
 * Pose un cookie côté serveur pour persister la préférence.
 */
export async function POST(req: NextRequest) {
  const { locale } = (await req.json().catch(() => ({}))) as { locale?: string };
  if (!isLocale(locale)) {
    return NextResponse.json({ error: 'Invalid locale' }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true, locale });
  res.cookies.set(LOCALE_COOKIE_NAME, locale, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 an
  });
  return res;
}
