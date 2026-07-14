import { NextResponse } from "next/server";
import { readFile, writeFile, readdir, stat, open } from "fs/promises";
import { exec } from "child_process";
import { join } from "path";
import { homedir } from "os";
import { promisify } from "util";

const execAsync = promisify(exec);
const DATA_PATH = join(process.cwd(), "data", "sessions.json");
const UNMATCHED_PATH = join(process.cwd(), "data", "unmatched-models.json");
const CUSTOM_PRICING_PATH = join(process.cwd(), "data", "custom-pricing.json");

// Provedores locais (self-hosted / sem custo de API)
const LOCAL_PROVIDER_RE = /^(ollama|lm[-_]?studio|vllm|llama[-_]?cpp|llamafile|local)$/i;

// Limite mínimo de tokens pra considerar "uso real" de um modelo
// (descarta sessões com < N tokens que naturalmente dariam custo ~0)
const MIN_TOKENS_FOR_DETECTION = 1000;

/**
 * Lê os JSONLs do pi e devolve um Set de session_ids
 * que usam EXCLUSIVAMENTE providers locais (ollama, lm-studio, vllm, etc).
 * Se uma sessão mistura provider local com cloud, NÃO entra no set.
 */
async function detectLocalPiSessions(): Promise<Set<string>> {
  const localIds = new Set<string>();
  const root = join(homedir(), ".pi", "agent", "sessions");

  async function walk(dir: string): Promise<string[]> {
    const out: string[] = [];
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...(await walk(p)));
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
    }
    return out;
  }

  const files = await walk(root);

  for (const file of files) {
    try {
      // Lê só os primeiros ~32KB — onde ficam os model_change iniciais.
      const fh = await stat(file);
      const max = Math.min(fh.size, 32 * 1024);
      const fd = await open(file, "r");
      try {
        const buf = new Uint8Array(max);
        await fd.read(buf, 0, max, 0);
        const text = new TextDecoder("utf-8").decode(buf);

        // Pega o session id (primeira linha type:session)
        const idMatch = text.match(/"id"\s*:\s*"([0-9a-f-]{36})"/);
        const sessionId = idMatch?.[1];
        if (!sessionId) continue;

        // Coleta todos os providers vistos em model_change
        const providerMatches = text.matchAll(/"provider"\s*:\s*"([^"]+)"/g);
        const providers = new Set<string>();
        for (const m of providerMatches) providers.add(m[1].toLowerCase());

        if (providers.size === 0) continue; // sem info de provider, não zera

        // É local se TODOS os providers forem locais
        const allLocal = Array.from(providers).every((p) => LOCAL_PROVIDER_RE.test(p));
        if (allLocal) localIds.add(sessionId);
      } finally {
        await fd.close();
      }
    } catch {
      // ignora arquivo com erro de leitura
    }
  }

  return localIds;
}

export async function POST() {
  try {
    // 1) Roda tokscale
    const cmd = "npx -y tokscale@latest report --no-summarize --json";
    const { stdout } = await execAsync(cmd, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 180_000,
    });
    const data: any[] = JSON.parse(stdout);

    // 2) Detecta automaticamente sessões com provider local
    const localIds = await detectLocalPiSessions();

    // 3) Zera o custo dessas sessões
    let zeroedCount = 0;
    let zeroedCost = 0;
    for (const s of data) {
      if (localIds.has(s.session_id) && s.total_cost > 0) {
        zeroedCost += s.total_cost;
        s.total_cost = 0;
        s._local_provider = true;
        zeroedCount++;
      }
    }

    // 4) Detecta modelos com uso real mas custo = $0 (provavelmente não precificados)
    const unmatched = detectUnmatchedModels(data);
    await writeFile(UNMATCHED_PATH, JSON.stringify(unmatched, null, 2), "utf-8");

    // 5) Salva o JSON modificado
    await writeFile(DATA_PATH, JSON.stringify(data), "utf-8");

    return NextResponse.json({
      ok: true,
      sessions: data.length,
      localSessions: localIds.size,
      zeroedCount,
      zeroedCost: Number(zeroedCost.toFixed(4)),
      unmatchedCount: unmatched.length,
      refreshedAt: Date.now(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message, stderr: err.stderr },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const data = JSON.parse(await readFile(DATA_PATH, "utf-8"));
    return NextResponse.json({
      sessions: data.length,
      fileExists: true,
    });
  } catch {
    return NextResponse.json({ sessions: 0, fileExists: false });
  }
}

/**
 * Detecta modelos com uso real (tokens > threshold) mas custo = $0.
 * Provavelmente são modelos sem preço no LiteLLM / OpenRouter / Models.dev.
 * Retorna ordenado por tokens totais (desc), sem duplicar modelos.
 */
function detectUnmatchedModels(data: any[]): Array<{
  model: string;
  sessions: number;
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  exampleSessionTitle: string;
}> {
  const m = new Map<string, {
    sessions: number;
    totalInput: number;
    totalOutput: number;
    totalTokens: number;
    exampleSessionTitle: string;
  }>();

  for (const s of data) {
    const totalTok = (s.total_input_tokens ?? 0) + (s.total_output_tokens ?? 0);
    if (totalTok < MIN_TOKENS_FOR_DETECTION) continue;

    // Pula sessões que já foram marcadas como local (custo zerado intencionalmente)
    if (s._local_provider) continue;

    for (const model of s.models_used ?? []) {
      // Sessão inteira tem custo 0 → modelo provavelmente sem preço
      if ((s.total_cost ?? 0) > 0) continue;

      const cur = m.get(model) ?? {
        sessions: 0,
        totalInput: 0,
        totalOutput: 0,
        totalTokens: 0,
        exampleSessionTitle: "",
      };
      cur.sessions += 1;
      cur.totalInput += s.total_input_tokens ?? 0;
      cur.totalOutput += s.total_output_tokens ?? 0;
      cur.totalTokens += totalTok;
      if (!cur.exampleSessionTitle && s.title) {
        cur.exampleSessionTitle = s.title;
      }
      m.set(model, cur);
    }
  }

  return Array.from(m.entries())
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
}
