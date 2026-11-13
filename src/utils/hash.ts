/** cyrb53: fast, deterministic 53-bit string hash. Must match scripts/epd-hash.mjs. */
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Random unique id for records that have no natural key. */
export function uid(prefix = ''): string {
  const c = globalThis.crypto;
  const rand = c?.randomUUID ? c.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 18);
  return prefix + Date.now().toString(36) + rand;
}
