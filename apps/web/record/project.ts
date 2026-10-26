export const AUTHORIZED_SUPABASE_HOST = 'hivfaqlabtbrhrviwrrm.supabase.co';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function projectOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== AUTHORIZED_SUPABASE_HOST) return null;
    return url.origin;
  } catch {
    return null;
  }
}
