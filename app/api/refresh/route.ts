import { NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { exec } from "child_process";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function POST() {
  try {
    const filePath = path.join(process.cwd(), "data", "sessions.json");

    // Re-roda tokscale via npx
    // Usa --no-summarize para não chamar LLM (rápido)
    const cmd = "npx -y tokscale@latest report --no-summarize --json";
    const { stdout, stderr } = await execAsync(cmd, {
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer (JSON pode ser grande)
      timeout: 180_000, // 3min timeout
    });

    // Salva o resultado no arquivo
    await writeFile(filePath, stdout, "utf-8");

    // Parse pra contar
    const data = JSON.parse(stdout);

    return NextResponse.json({
      ok: true,
      sessions: data.length,
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
    const filePath = path.join(process.cwd(), "data", "sessions.json");
    const stat = await readFile(filePath, "utf-8");
    const data = JSON.parse(stat);
    return NextResponse.json({
      sessions: data.length,
      fileExists: true,
    });
  } catch {
    return NextResponse.json({ sessions: 0, fileExists: false });
  }
}
