import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

/**
 * Catálogo de preços LiteLLM — mesma fonte que o tokscale usa.
 * Arquivo: model_prices_and_context_window.json (BerriAI/litellm @ GitHub).
 *
 * Cache: 1h em memória. Se o fetch falhar, usa o arquivo cacheado em
 * data/litellm-prices.json (criado pelo script de refresh).
 */

const CACHE_PATH = join(process.cwd(), "data", "litellm-prices.json");
const CATALOG_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

let cache: { data: CatalogEntry[]; ts: number } | null = null;
const TTL_MS = 60 * 60 * 1000; // 1h

type CatalogEntry = {
  id: string;
  inputPerMillion: number;
  outputPerMillion: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  provider?: string;
  mode?: string;
};

async function loadFromDisk(): Promise<Record<string, any> | null> {
  try {
    const text = await readFile(CACHE_PATH, "utf-8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function fetchFresh(): Promise<Record<string, any>> {
  const res = await fetch(CATALOG_URL, {
    headers: { "User-Agent": "usage-dashboard/1.0" },
    // 20s timeout via AbortSignal
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`LiteLLM catalog HTTP ${res.status}`);
  return await res.json();
}

async function getCatalog(): Promise<CatalogEntry[]> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.data;

  let raw: Record<string, any> | null = null;
  let source: "fresh" | "disk" = "fresh";
  try {
    raw = await fetchFresh();
  } catch (e) {
    raw = await loadFromDisk();
    source = "disk";
    if (!raw) throw e;
  }

  // Normaliza para o nosso formato
  const entries: CatalogEntry[] = [];
  for (const [id, v] of Object.entries(raw)) {
    if (!v || typeof v !== "object") continue;
    const vin = v.input_cost_per_token;
    const vout = v.output_cost_per_token;
    if (typeof vin !== "number" || typeof vout !== "number") continue;
    // Ignora preços zero/negativos e modos não-chat
    if (vin < 0 || vout < 0) continue;
    if (v.mode && v.mode !== "chat" && v.mode !== "responses") continue;

    // Provider heurístico: primeira parte do id
    const provider = id.split(/[\/\-]/, 1)[0];

    entries.push({
      id,
      inputPerMillion: Number((vin * 1_000_000).toFixed(6)),
      outputPerMillion: Number((vout * 1_000_000).toFixed(6)),
      maxInputTokens: v.max_input_tokens ?? v.max_tokens,
      maxOutputTokens: v.max_output_tokens,
      provider,
      mode: v.mode,
    });
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  cache = { data: entries, ts: Date.now() };
  console.log(`[catalog] loaded ${entries.length} entries (source: ${source})`);
  return entries;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "200"), 1000);

    const all = await getCatalog();

    let filtered = all;
    if (q) {
      filtered = all.filter(
        (e) =>
          e.id.toLowerCase().includes(q) ||
          (e.provider ?? "").toLowerCase().includes(q)
      );
    }

    // Limita resposta. Ordena por relevância simples se tem query.
    let results = filtered;
    if (q && filtered.length > limit) {
      // Prioriza matches exatos no início
      const startsWith = filtered.filter((e) =>
        e.id.toLowerCase().startsWith(q)
      );
      const contains = filtered.filter(
        (e) =>
          !e.id.toLowerCase().startsWith(q) && e.id.toLowerCase().includes(q)
      );
      results = [...startsWith, ...contains].slice(0, limit);
    } else {
      results = filtered.slice(0, limit);
    }

    return NextResponse.json(
      {
        total: all.length,
        matched: filtered.length,
        returned: results.length,
        cachedAt: cache?.ts,
        query: q,
        results,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
