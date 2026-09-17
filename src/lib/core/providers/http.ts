/** Petit client HTTP partage : cache memoire, retry, limite de concurrence. */

/**
 * Les navigateurs interdisent de definir User-Agent : Modrinth l'accepte et
 * identifie l'appelant par l'origine. On ne l'envoie donc pas.
 */

interface CacheEntry {
  at: number;
  value: unknown;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 10 * 60 * 1000;

let active = 0;
const queue: (() => void)[] = [];
const MAX_CONCURRENT = 6;

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly provider: string,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  provider: string;
  /** desactive le cache memoire */
  noCache?: boolean;
  /** renvoie null au lieu de lever une erreur sur un 404 */
  nullOn404?: boolean;
}

export async function request<T>(
  url: string,
  opts: RequestOptions,
): Promise<T | null> {
  const method = opts.method ?? "GET";
  const cacheKey = `${method} ${url} ${opts.body ? JSON.stringify(opts.body) : ""}`;

  if (!opts.noCache) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value as T;
  }

  const result = await withSlot(async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers: {
            Accept: "application/json",
            ...(opts.body ? { "Content-Type": "application/json" } : {}),
            ...opts.headers,
          },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });

        if (res.status === 404 && opts.nullOn404) return null;

        if (res.status === 429) {
          const retryAfter = Number(res.headers.get("retry-after") ?? "2");
          await sleep(Math.min(retryAfter * 1000, 10_000));
          continue;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new ProviderError(
            `${opts.provider} a repondu ${res.status}: ${text.slice(0, 200)}`,
            res.status,
            opts.provider,
          );
        }

        return (await res.json()) as T;
      } catch (err) {
        lastErr = err;
        // 4xx (hors 429) : inutile de reessayer
        if (err instanceof ProviderError && err.status < 500) throw err;
        if (attempt < 2) await sleep(400 * (attempt + 1));
      }
    }
    throw lastErr;
  });

  if (!opts.noCache) cache.set(cacheKey, { at: Date.now(), value: result });
  return result as T | null;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Decoupe un tableau en lots de taille n (pour les endpoints bulk). */
export function chunk<T>(items: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}
