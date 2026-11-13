// Imported metadata is untrusted. React escapes text content, but we still strip control
// characters and bound lengths so oversized or malformed headers cannot break layouts or storage.
export function cleanText(value: unknown, maxLength = 120): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, maxLength);
}

export function cleanUsername(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 50);
}

/** Only allow http(s) links to known chess sites to be rendered as anchors. */
export function safeGameUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (!/(^|\.)chess\.com$|(^|\.)lichess\.org$/.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}
