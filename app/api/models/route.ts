import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

const DATA_PATH = join(process.cwd(), "data", "sessions.json");
const CUSTOM_PRICING_PATH = join(process.cwd(), "data", "custom-pricing.json");
const UNMATCHED_PATH = join(process.cwd(), "data", "unmatched-models.json");
const LITELLM_PATH = join(process.cwd(), "data", "litellm-prices.json");

/**
 * Carrega o catálogo LiteLLM (mesma fonte do tokscale).
 * Retorna mapa: id → { inputPerMillion, outputPerMillion }.
 */
async function loadLiteLLM(): Promise<Record<string, { inputPerMillion: number; outputPerMillion: number }>> {
  try {
    const raw = JSON.parse(await readFile(LITELLM_PATH, "utf-8")) as Record<string, any>;
    const out: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {};
    for (const [id, v] of Object.entries(raw)) {
      if (!v || typeof v !== "object") continue;
      const vin = v.input_cost_per_token;
      const vout = v.output_cost_per_token;
      if (typeof vin !== "number" || typeof vout !== "number") continue;
      if (vin < 0 || vout < 0) continue;
      if (v.mode && v.mode !== "chat" && v.mode !== "responses") continue;
      out[id.toLowerCase()] = {
        inputPerMillion: Number((vin * 1_000_000).toFixed(6)),
        outputPerMillion: Number((vout * 1_000_000).toFixed(6)),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Tenta achar o preço LiteLLM de um modelo. Estratégia:
 * 1. Match exato (lowercase)
 * 2. Removendo sufixo ":cloud", "-cloud", etc
 * 3. Match com prefixo de provider (ex: "openai/gpt-5.2")
 */
function findLiteLLMPrice(
  model: string,
  catalog: Record<string, { inputPerMillion: number; outputPerMillion: number }>
): { inputPerMillion: number; outputPerMillion: number } | null {
  const norm = (s: string) => s.toLowerCase().trim();
  const m = norm(model);

  // 1. Exato
  if (catalog[m]) return catalog[m];

  // 2. Remover sufixos comuns (":cloud", "-cloud", "_cloud", ":free", "-free")
  const stripped = m.replace(/[:\-_](cloud|free)$/, "");
  if (stripped !== m && catalog[stripped]) return catalog[stripped];

  // 3. Match com "provider/" — tenta achar com prefixo
  // Ex: "gpt-5.2" → "openai/gpt-5.2"
  // Procura qualquer chave que termine com "/<model>" ou "<model>"
  const exactSuffixes = [m, stripped].filter((s, i, arr) => arr.indexOf(s) === i);
  for (const target of exactSuffixes) {
    for (const key of Object.keys(catalog)) {
      if (key === target) return catalog[key];
      if (key.endsWith("/" + target)) return catalog[key];
    }
  }

  return null;
}

/**
 * Agrega estatísticas por modelo a partir de sessions.json.
 * Retorna: nome, # sessões, total de tokens in/out, custo total, status, e preços.
 *
 * Status:
 * - "custom":    tem override com preço real (input>0 ou output>0) em custom-pricing.json
 * - "unmatched": está em unmatched-models.json (LiteLLM não tem) E sem custom com valor
 * - "priced":    LiteLLM tem preço (tokscale calcula)
 *
 * Preços:
 * - customPrice:   override do usuário (se houver)
 * - litellmPrice:  preço que o tokscale aplicou (se achou no LiteLLM)
 */
export async function GET() {
  try {
    const [sessionsText, customText, unmatchedText, litellmCatalog] = await Promise.all([
      readFile(DATA_PATH, "utf-8"),
      readFile(CUSTOM_PRICING_PATH, "utf-8").catch(() => "{}"),
      readFile(UNMATCHED_PATH, "utf-8").catch(() => "[]"),
      loadLiteLLM(),
    ]);

    const sessions = JSON.parse(sessionsText) as Array<any>;
    const customPricing = JSON.parse(customText) as Record<string, any>;
    const unmatched: Array<{ model: string }> = JSON.parse(unmatchedText);

    const unmatchedSet = new Set(unmatched.map((u) => u.model));

    // Cache de preços LiteLLM por nome (evita refazer a busca pra modelos repetidos)
    const litellmCache = new Map<string, { inputPerMillion: number; outputPerMillion: number } | null>();

    // Agrega por modelo. Cada sessão pode ter múltiplos modelos (models_used).
    // Quando há múltiplos, distribuímos os tokens/custo igualitariamente.
    const acc = new Map<string, {
      sessions: number;
      totalInput: number;
      totalOutput: number;
      totalCost: number;
    }>();

    for (const s of sessions) {
      const models: string[] = s.models_used ?? [];
      if (models.length === 0) continue;
      const share = 1 / models.length;
      for (const m of models) {
        const cur = acc.get(m) ?? { sessions: 0, totalInput: 0, totalOutput: 0, totalCost: 0 };
        cur.sessions += 1;
        cur.totalInput += s.total_input_tokens * share;
        cur.totalOutput += s.total_output_tokens * share;
        cur.totalCost += (s.total_cost ?? 0) * share;
        acc.set(m, cur);
      }
    }

    const models = Array.from(acc.entries())
      .map(([name, v]) => {
        // Status baseado em QUEM FORNECE O PREÇO REAL.
        // - "custom"    = usuário definiu inputPerMillion > 0 OR outputPerMillion > 0
        // - "unmatched" = em unmatched-models.json AND sem custom com valor
        // - "priced"    = LiteLLM tem preço (tokscale calcula)
        const custom = customPricing[name];
        const hasRealCustom =
          custom !== undefined &&
          (custom.inputPerMillion > 0 || custom.outputPerMillion > 0);

        let status: "custom" | "unmatched" | "priced";
        if (hasRealCustom) {
          status = "custom";
        } else if (unmatchedSet.has(name)) {
          status = "unmatched";
        } else {
          status = "priced";
        }

        // Preço LiteLLM (se aplicável)
        if (!litellmCache.has(name)) {
          litellmCache.set(name, findLiteLLMPrice(name, litellmCatalog));
        }
        const litellmPrice = litellmCache.get(name) ?? null;

        return {
          name,
          sessions: v.sessions,
          totalInput: Math.round(v.totalInput),
          totalOutput: Math.round(v.totalOutput),
          totalCost: Number(v.totalCost.toFixed(4)),
          status,
          customPrice: custom
            ? {
                inputPerMillion: custom.inputPerMillion,
                outputPerMillion: custom.outputPerMillion,
                note: custom.note,
                updatedAt: custom.updatedAt,
              }
            : null,
          litellmPrice,
        };
      })
      // Ordena por sessões desc
      .sort((a, b) => b.sessions - a.sessions);

    return NextResponse.json(
      { models },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
