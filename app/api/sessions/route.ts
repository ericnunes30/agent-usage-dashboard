import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

const DATA_PATH = join(process.cwd(), "data", "sessions.json");
const CUSTOM_PRICING_PATH = join(process.cwd(), "data", "custom-pricing.json");

/**
 * Lê o custom-pricing.json. Retorna mapa: model → { inputPerToken, outputPerToken }.
 * O preço armazenado está em $/M tokens; convertemos pra $/token aqui.
 */
async function loadCustomPricing(): Promise<Record<
  string,
  { inputPerToken: number; outputPerToken: number; note?: string }
>> {
  try {
    const raw = JSON.parse(await readFile(CUSTOM_PRICING_PATH, "utf-8"));
    const out: Record<string, { inputPerToken: number; outputPerToken: number; note?: string }> = {};
    for (const [model, val] of Object.entries(raw)) {
      const v = val as any;
      if (typeof v.inputPerMillion === "number" && typeof v.outputPerMillion === "number") {
        out[model] = {
          inputPerToken: v.inputPerMillion / 1_000_000,
          outputPerToken: v.outputPerMillion / 1_000_000,
          note: v.note,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const [sessionsText, customPricing] = await Promise.all([
      readFile(DATA_PATH, "utf-8"),
      loadCustomPricing(),
    ]);
    const data = JSON.parse(sessionsText);

    if (Object.keys(customPricing).length > 0) {
      // Aplica overrides: recalcula total_cost da sessão com base no nosso preço
      // Distribui o custo proporcionalmente pelos modelos (mesma heurística do byModel)
      for (const s of data) {
        const models = s.models_used ?? [];
        if (models.length === 0) continue;
        // Se TODOS os modelos têm override, aplica a soma
        const allOverridden = models.every((m: string) => m in customPricing);
        if (allOverridden) {
          let newCost = 0;
          for (const m of models) {
            const p = customPricing[m];
            newCost +=
              s.total_input_tokens * p.inputPerToken +
              s.total_output_tokens * p.outputPerToken;
          }
          if (s.total_cost !== newCost) {
            const oldCost = s.total_cost;
            s.total_cost = Number(newCost.toFixed(6));
            s._pricing_overridden = true;
            s._original_cost = oldCost;
          }
        }
      }
    }

    return NextResponse.json(data, {
      headers: {
        // cache 5min — gera uma vez, lê várias
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
