import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

const UNMATCHED_PATH = join(process.cwd(), "data", "unmatched-models.json");
const CUSTOM_PRICING_PATH = join(process.cwd(), "data", "custom-pricing.json");

type UnmatchedModel = {
  model: string;
  sessions: number;
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  exampleSessionTitle: string;
};

export async function GET() {
  try {
    const [unmatchedText, customText] = await Promise.all([
      readFile(UNMATCHED_PATH, "utf-8"),
      readFile(CUSTOM_PRICING_PATH, "utf-8").catch(() => "{}"),
    ]);
    const allUnmatched: UnmatchedModel[] = JSON.parse(unmatchedText);
    const custom: Record<string, { inputPerMillion: number; outputPerMillion: number }> = JSON.parse(customText);

    // Filtra: um modelo deixa de ser "sem preço" quando o usuário define
    // um override com input>0 ou output>0 em custom-pricing.json.
    // Sem isso, o dashboard principal e a página /models mostrariam
    // contagens divergentes (mesma lógica aplicada em /api/models).
    const data = allUnmatched.filter((u) => {
      const cp = custom[u.model];
      if (!cp) return true;
      return cp.inputPerMillion <= 0 && cp.outputPerMillion <= 0;
    });

    return NextResponse.json(data);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Recebe overrides de preço e persiste em custom-pricing.json.
 * Body: { overrides: Array<{ model: string, inputPerMillion: number, outputPerMillion: number }> }
 *
 * Importante: o preço está em $/M tokens (como o LiteLLM).
 * O nosso back-end converte para $/token ao aplicar.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const overrides: Array<{
      model: string;
      inputPerMillion?: number;
      outputPerMillion?: number;
      note?: string;
    }> = body?.overrides ?? [];

    if (!Array.isArray(overrides) || overrides.length === 0) {
      return NextResponse.json(
        { error: "overrides[] é obrigatório e não pode estar vazio" },
        { status: 400 }
      );
    }

    // Lê o custom-pricing.json existente (se houver)
    let custom: Record<string, {
      inputPerMillion: number;
      outputPerMillion: number;
      note?: string;
      updatedAt: number;
    }> = {};
    try {
      custom = JSON.parse(await readFile(CUSTOM_PRICING_PATH, "utf-8"));
    } catch {
      // arquivo não existe ainda
    }

    let added = 0;
    let updated = 0;
    for (const o of overrides) {
      if (!o.model || typeof o.model !== "string") continue;
      if (
        typeof o.inputPerMillion !== "number" ||
        typeof o.outputPerMillion !== "number"
      ) {
        continue;
      }
      const isNew = !custom[o.model];
      custom[o.model] = {
        inputPerMillion: o.inputPerMillion,
        outputPerMillion: o.outputPerMillion,
        note: o.note,
        updatedAt: Date.now(),
      };
      if (isNew) added++;
      else updated++;
    }

    await writeFile(CUSTOM_PRICING_PATH, JSON.stringify(custom, null, 2), "utf-8");

    return NextResponse.json({ ok: true, added, updated, total: Object.keys(custom).length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
