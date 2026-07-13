import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "data", "sessions.json");
    const content = await readFile(filePath, "utf-8");
    const data = JSON.parse(content);
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
