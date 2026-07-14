import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

const DATA_PATH = join(process.cwd(), "data", "sessions.json");
const CUSTOM_PRICING_PATH = join(process.cwd(), "data", "custom-pricing.json");
const UNMATCHED_PATH = join(process.cwd(), "data", "unmatched-models.json");

/**
 * Agrega estatísticas por modelo a partir de sessions.json.
 * Retorna: nome, # sessões, total de tokens in/out, custo total, e status.
 *
 * Status:
 * - "custom": tem override em custom-pricing.json
 * - "unmatched": está em unmatched-models.json (sem preço no LiteLLM)
 * - "priced": tem preço no tokscale/LiteLLM (custo > 0 e não-custom)
 *
 * Importante: o cálculo de custo aqui NÃO aplica custom pricing — queremos
 * o custo "bruto" do tokscale pra mostrar o impacto real. O custom-pricing
 * é aplicado em /api/sessions pra recalcular o total_cost.
 */
export async function GET() {
  try {
    const [sessionsText, customText, unmatchedText] = await Promise.all([
      readFile(DATA_PATH, "utf-8"),
      readFile(CUSTOM_PRICING_PATH, "utf-8").catch(() => "{}"),
      readFile(UNMATCHED_PATH, "utf-8").catch(() => "[]"),
    ]);

    const sessions = JSON.parse(sessionsText) as Array<any>;
    const customPricing = JSON.parse(customText) as Record<string, any>;
    const unmatched: Array<{ model: string }> = JSON.parse(unmatchedText);

    const unmatchedSet = new Set(unmatched.map((u) => u.model));
    const customKeys = new Set(Object.keys(customPricing));

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
        // - "unmatched" (Sem preço) = LiteLLM não tem E custom é 0/0 (sem preço real)
        // - "custom" (Custom)      = usuário definiu inputPerMillion ou outputPerMillion > 0
        // - "priced" (Com preço)   = LiteLLM tem preço (tokscale calcula)
        // Adicionar um preço real em custom-pricing.json move o modelo
        // de "Sem preço" para "Custom".
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
