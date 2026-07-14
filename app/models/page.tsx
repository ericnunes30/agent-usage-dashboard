"use client";

import { useEffect, useMemo, useState } from "react";
import Sidebar from "../components/Sidebar";

type ModelInfo = {
  name: string;
  sessions: number;
  totalInput: number;
  totalOutput: number;
  totalCost: number;
  status: "custom" | "unmatched" | "priced";
  customPrice: {
    inputPerMillion: number;
    outputPerMillion: number;
    note?: string;
    updatedAt: number;
  } | null;
};

type FilterStatus = "all" | "priced" | "unmatched" | "custom";

function fmt(n: number): string {
  const formatted = new Intl.NumberFormat("pt-BR").format(n);
  if (n >= 1_000_000_000) return formatted + " bi";
  if (n >= 1_000_000) return formatted + " mi";
  return formatted;
}
function fmtCost(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(usd);
}

export default function ModelsPage() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editInput, setEditInput] = useState<string>("");
  const [editOutput, setEditOutput] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/models", { cache: "no-store" });
      const data = await res.json();
      setModels(data.models ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    let list = models;
    if (filter !== "all") list = list.filter((m) => m.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((m) => m.name.toLowerCase().includes(q));
    }
    return list;
  }, [models, search, filter]);

  const counts = useMemo(
    () => ({
      all: models.length,
      priced: models.filter((m) => m.status === "priced").length,
      unmatched: models.filter((m) => m.status === "unmatched").length,
      custom: models.filter((m) => m.status === "custom").length,
    }),
    [models]
  );

  function startEdit(m: ModelInfo) {
    setEditing(m.name);
    setEditInput(String(m.customPrice?.inputPerMillion ?? ""));
    setEditOutput(String(m.customPrice?.outputPerMillion ?? ""));
  }

  function cancelEdit() {
    setEditing(null);
    setEditInput("");
    setEditOutput("");
  }

  async function saveEdit(modelName: string) {
    const input = parseFloat(editInput);
    const output = parseFloat(editOutput);
    if (isNaN(input) || isNaN(output) || input < 0 || output < 0) {
      setError("Preços devem ser números ≥ 0");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/unmatched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          overrides: [
            { model: modelName, inputPerMillion: input, outputPerMillion: output },
          ],
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Erro ao salvar");
      await load();
      setEditing(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function statusBadge(status: ModelInfo["status"]) {
    if (status === "custom") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-brand-primary/15 text-brand-primary border border-brand-primary/30">
          <span className="material-symbols-outlined text-[12px]">star</span>
          Custom
        </span>
      );
    }
    if (status === "unmatched") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-amber-950/40 text-amber-400 border border-amber-800/50">
          <span className="material-symbols-outlined text-[12px]">warning</span>
          Sem preço
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-emerald-950/40 text-emerald-400 border border-emerald-800/50">
        <span className="material-symbols-outlined text-[12px]">check_circle</span>
        Com preço
      </span>
    );
  }

  return (
    <div className="flex min-h-screen bg-brand-bg text-brand-text font-sans">
      <Sidebar />

      <main className="flex-grow flex flex-col min-h-screen md:w-[calc(100%-16rem)]">
        <header className="flex justify-between items-center w-full px-4 md:px-8 py-4 sticky top-0 z-50 bg-brand-bg/95 backdrop-blur border-b border-brand-border">
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold text-brand-primary leading-tight tracking-tight">
              Modelos
            </h1>
            <p className="text-sm text-brand-text-muted mt-0.5">
              Pesquise e gerencie preços de modelos — tokscale · LiteLLM · custom
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 bg-brand-surface border border-brand-border rounded-lg text-xs font-semibold uppercase tracking-wider text-brand-text-muted hover:text-brand-text hover:border-brand-primary/30 transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">refresh</span>
              {loading ? "Carregando..." : "Atualizar"}
            </button>
          </div>
        </header>

        <div className="p-4 md:p-8 flex flex-col gap-6 flex-grow">
          {/* Search + Filters */}
          <div className="bg-brand-surface border border-brand-border rounded-lg p-4 flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted text-[18px]">
                search
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar modelo por nome..."
                className="w-full pl-10 pr-3 py-2 bg-brand-bg border border-brand-border rounded-lg text-sm text-brand-text placeholder:text-brand-text-muted focus:outline-none focus:border-brand-primary/50"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {(
                [
                  { v: "all", label: "Todos", n: counts.all },
                  { v: "priced", label: "Com preço", n: counts.priced },
                  { v: "unmatched", label: "Sem preço", n: counts.unmatched },
                  { v: "custom", label: "Custom", n: counts.custom },
                ] as { v: FilterStatus; label: string; n: number }[]
              ).map((f) => (
                <button
                  key={f.v}
                  onClick={() => setFilter(f.v)}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors ${
                    filter === f.v
                      ? "bg-secondary-container text-on-secondary-container"
                      : "bg-brand-bg text-brand-text-muted hover:bg-surface-container-high border border-brand-border"
                  }`}
                >
                  {f.label}{" "}
                  <span className="ml-1 opacity-60">({f.n})</span>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-950/40 border border-red-800/50 text-red-400 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Table */}
          <div className="bg-brand-surface border border-brand-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-brand-border bg-surface-container-low">
                    <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-brand-text-muted">
                      Modelo
                    </th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-brand-text-muted">
                      Status
                    </th>
                    <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-brand-text-muted">
                      Sessões
                    </th>
                    <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-brand-text-muted">
                      Tokens In
                    </th>
                    <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-brand-text-muted">
                      Tokens Out
                    </th>
                    <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-brand-text-muted">
                      Custo
                    </th>
                    <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-brand-text-muted">
                      $ In/1M
                    </th>
                    <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-brand-text-muted">
                      $ Out/1M
                    </th>
                    <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-brand-text-muted">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-brand-text-muted">
                        Carregando modelos...
                      </td>
                    </tr>
                  )}
                  {!loading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-brand-text-muted">
                        Nenhum modelo encontrado.
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    filtered.map((m) => {
                      const isEditing = editing === m.name;
                      return (
                        <>
                          <tr
                            key={m.name}
                            className="border-b border-brand-border/50 hover:bg-surface-container-low/40 transition-colors"
                          >
                            <td className="px-4 py-3 font-mono text-xs text-brand-text">
                              {m.name}
                            </td>
                            <td className="px-4 py-3">{statusBadge(m.status)}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-brand-text-muted">
                              {m.sessions.toLocaleString("pt-BR")}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-brand-text-muted">
                              {fmt(m.totalInput)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-brand-text-muted">
                              {fmt(m.totalOutput)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-brand-text">
                              {fmtCost(m.totalCost)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-brand-text">
                              {isEditing ? (
                                <input
                                  type="number"
                                  step="0.0001"
                                  min="0"
                                  value={editInput}
                                  onChange={(e) => setEditInput(e.target.value)}
                                  className="w-20 px-2 py-1 bg-brand-bg border border-brand-border rounded text-right text-xs text-brand-text focus:outline-none focus:border-brand-primary/50"
                                />
                              ) : m.customPrice ? (
                                `$${m.customPrice.inputPerMillion.toFixed(4)}`
                              ) : m.status === "priced" ? (
                                <span className="text-brand-text-muted/60 text-xs">
                                  LiteLLM
                                </span>
                              ) : (
                                <span className="text-brand-text-muted/40">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-brand-text">
                              {isEditing ? (
                                <input
                                  type="number"
                                  step="0.0001"
                                  min="0"
                                  value={editOutput}
                                  onChange={(e) => setEditOutput(e.target.value)}
                                  className="w-20 px-2 py-1 bg-brand-bg border border-brand-border rounded text-right text-xs text-brand-text focus:outline-none focus:border-brand-primary/50"
                                />
                              ) : m.customPrice ? (
                                `$${m.customPrice.outputPerMillion.toFixed(4)}`
                              ) : m.status === "priced" ? (
                                <span className="text-brand-text-muted/60 text-xs">
                                  LiteLLM
                                </span>
                              ) : (
                                <span className="text-brand-text-muted/40">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {isEditing ? (
                                <div className="flex gap-1 justify-end">
                                  <button
                                    onClick={() => saveEdit(m.name)}
                                    disabled={saving}
                                    className="px-2 py-1 bg-brand-primary/15 text-brand-primary border border-brand-primary/30 rounded text-xs font-semibold hover:bg-brand-primary/25 disabled:opacity-50"
                                  >
                                    {saving ? "..." : "Salvar"}
                                  </button>
                                  <button
                                    onClick={cancelEdit}
                                    disabled={saving}
                                    className="px-2 py-1 text-brand-text-muted hover:text-brand-text text-xs"
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => startEdit(m)}
                                  className="px-2 py-1 text-brand-text-muted hover:text-brand-primary text-xs font-semibold uppercase tracking-wider inline-flex items-center gap-1"
                                >
                                  <span className="material-symbols-outlined text-[14px]">edit</span>
                                  Editar
                                </button>
                              )}
                            </td>
                          </tr>
                        </>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 text-xs text-brand-text-muted">
            <div className="flex items-center gap-2">
              {statusBadge("priced")}
              <span>modelo tem preço no LiteLLM (tokscale calcula)</span>
            </div>
            <div className="flex items-center gap-2">
              {statusBadge("unmatched")}
              <span>modelo sem preço no LiteLLM (custo zerado)</span>
            </div>
            <div className="flex items-center gap-2">
              {statusBadge("custom")}
              <span>preço definido manualmente em custom-pricing.json</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
