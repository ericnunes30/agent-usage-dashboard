"use client";

import { useEffect, useMemo, useState } from "react";
import Sidebar from "../components/Sidebar";

/**
 * Formata um preço USD de forma inteligente por magnitude:
 * - >= $0.01:   2 casas decimais (ex: $1.20, $4.00, $0.95) — padrão de mercado
 * - $0.0001-$0.0099: 4 casas decimais (ex: $0.0050)
 * - < $0.0001:  6 casas decimais (ex: $0.000123)
 * Sempre usa ponto como separador decimal (formato US para preço unitário).
 */
function formatPrice(n: number): string {
  if (!isFinite(n) || isNaN(n)) return "$0";
  if (n === 0) return "$0.00";
  const abs = Math.abs(n);
  let decimals: number;
  if (abs >= 0.01) decimals = 2;
  else if (abs >= 0.0001) decimals = 4;
  else decimals = 6;
  return `$${n.toFixed(decimals)}`;
}

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
  litellmPrice: {
    inputPerMillion: number;
    outputPerMillion: number;
  } | null;
};

type CatalogEntry = {
  id: string;
  inputPerMillion: number;
  outputPerMillion: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  provider?: string;
  mode?: string;
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

function statusBadge(status: ModelInfo["status"], hasCustom: boolean) {
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

/**
 * Célula de preço ($ In/1M ou $ Out/1M).
 * Mostra o preço real e uma pequena etiqueta da fonte:
 * - Custom (verde): override do usuário
 * - LiteLLM (cinza): preço do tokscale/catálogo LiteLLM
 * - — (cinza claro): sem preço em lugar nenhum
 */
function PriceCell({
  value,
  isEditing,
  editValue,
  onEditChange,
}: {
  value: number | null;
  isEditing: boolean;
  editValue: string;
  onEditChange: (v: string) => void;
}) {
  if (isEditing) {
    return (
      <input
        type="number"
        step="0.01"
        min="0"
        value={editValue}
        onChange={(e) => onEditChange(e.target.value)}
        className="w-20 px-2 py-1 bg-brand-bg border border-brand-border rounded text-right text-xs text-brand-text focus:outline-none focus:border-brand-primary/50"
      />
    );
  }
  if (value === null) {
    return <span className="text-brand-text-muted/40">—</span>;
  }
  return <span>{formatPrice(value)}</span>;
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

  // Catálogo LiteLLM
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogResults, setCatalogResults] = useState<CatalogEntry[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogMatched, setCatalogMatched] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoaded, setCatalogLoaded] = useState(false);

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

  async function searchCatalog(q: string) {
    setCatalogQuery(q);
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const res = await fetch(
        `/api/catalog?q=${encodeURIComponent(q)}&limit=100`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error((await res.json()).error ?? "Erro no catálogo");
      const data = await res.json();
      setCatalogResults(data.results ?? []);
      setCatalogTotal(data.total ?? 0);
      setCatalogMatched(data.matched ?? 0);
      setCatalogLoaded(true);
    } catch (e: any) {
      setCatalogError(e.message);
    } finally {
      setCatalogLoading(false);
    }
  }

  // Carrega o catálogo inicial vazio (top N por nome)
  useEffect(() => {
    searchCatalog("");
  }, []);

  // Debounce de busca no catálogo
  useEffect(() => {
    const id = setTimeout(() => {
      if (catalogLoaded) searchCatalog(catalogQuery);
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogQuery]);

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
    // Mostra o valor sem zeros trailing (1.50 não 1.5000, 0.95 não 0.9500).
    const fmtEdit = (v: number | undefined) => {
      if (v === undefined || v === null || isNaN(v)) return "";
      if (v === 0) return "0";
      return String(parseFloat(v.toFixed(4)));
    };
    setEditInput(fmtEdit(m.customPrice?.inputPerMillion));
    setEditOutput(fmtEdit(m.customPrice?.outputPerMillion));
    // Pré-preenche o catálogo com o nome do modelo
    searchCatalog(m.name);
  }

  function cancelEdit() {
    setEditing(null);
    setEditInput("");
    setEditOutput("");
  }

  function applyFromCatalog(c: CatalogEntry) {
    setEditInput(String(c.inputPerMillion));
    setEditOutput(String(c.outputPerMillion));
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Tabela de Modelos */}
            <div className="lg:col-span-2 bg-brand-surface border border-brand-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between">
                <h3 className="text-sm font-semibold text-brand-text">Seus modelos</h3>
                <span className="text-[10px] uppercase tracking-wider text-brand-text-muted">
                  {filtered.length} de {counts.all}
                </span>
              </div>
              <div className="overflow-x-auto max-h-[calc(100vh-280px)] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-container-low z-10">
                    <tr className="border-b border-brand-border">
                      <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-brand-text-muted">
                        Modelo
                      </th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-brand-text-muted">
                        Status
                      </th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-brand-text-muted">
                        Sess.
                      </th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-brand-text-muted">
                        Custo
                      </th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-brand-text-muted">
                        $ In/1M
                      </th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-brand-text-muted">
                        $ Out/1M
                      </th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-brand-text-muted">
                        Ação
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-brand-text-muted">
                          Carregando modelos...
                        </td>
                      </tr>
                    )}
                    {!loading && filtered.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-brand-text-muted">
                          Nenhum modelo encontrado.
                        </td>
                      </tr>
                    )}
                    {!loading &&
                      filtered.map((m) => {
                        const isEditing = editing === m.name;
                        return (
                          <tr
                            key={m.name}
                            className={`border-b border-brand-border/50 transition-colors ${
                              isEditing
                                ? "bg-secondary-container/30"
                                : "hover:bg-surface-container-low/40"
                            }`}
                          >
                            <td className="px-3 py-2 font-mono text-xs text-brand-text">
                              {m.name}
                            </td>
                            <td className="px-3 py-2">{statusBadge(m.status, m.customPrice !== null)}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-brand-text-muted">
                              {m.sessions.toLocaleString("pt-BR")}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-brand-text">
                              {fmtCost(m.totalCost)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-brand-text">
                              <PriceCell
                                value={
                                  m.customPrice
                                    ? m.customPrice.inputPerMillion
                                    : m.litellmPrice
                                    ? m.litellmPrice.inputPerMillion
                                    : null
                                }
                                isEditing={isEditing}
                                editValue={editInput}
                                onEditChange={setEditInput}
                              />
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-brand-text">
                              <PriceCell
                                value={
                                  m.customPrice
                                    ? m.customPrice.outputPerMillion
                                    : m.litellmPrice
                                    ? m.litellmPrice.outputPerMillion
                                    : null
                                }
                                isEditing={isEditing}
                                editValue={editOutput}
                                onEditChange={setEditOutput}
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
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
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Painel Catálogo LiteLLM */}
            <div className="bg-brand-surface border border-brand-border rounded-lg overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between">
                <h3 className="text-sm font-semibold text-brand-text flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px] text-brand-primary">
                    library_books
                  </span>
                  Catálogo LiteLLM
                </h3>
                {catalogTotal > 0 && (
                  <span className="text-[10px] uppercase tracking-wider text-brand-text-muted">
                    {catalogMatched.toLocaleString("pt-BR")} de {catalogTotal.toLocaleString("pt-BR")}
                  </span>
                )}
              </div>

              {/* Search bar do catálogo */}
              <div className="p-3 border-b border-brand-border">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted text-[18px]">
                    travel_explore
                  </span>
                  <input
                    type="text"
                    value={catalogQuery}
                    onChange={(e) => setCatalogQuery(e.target.value)}
                    placeholder="Buscar no catálogo (ex: glm, gpt-4, claude)..."
                    className="w-full pl-10 pr-3 py-2 bg-brand-bg border border-brand-border rounded-lg text-sm text-brand-text placeholder:text-brand-text-muted focus:outline-none focus:border-brand-primary/50"
                  />
                </div>
                {editing && (
                  <p className="text-[10px] text-brand-primary mt-2 uppercase tracking-wider">
                    Editando: <span className="font-mono normal-case">{editing}</span> · clique em um modelo para preencher
                  </p>
                )}
              </div>

              {/* Lista do catálogo */}
              <div className="overflow-y-auto flex-grow max-h-[calc(100vh-380px)]">
                {catalogError && (
                  <div className="p-3 text-xs text-red-400">{catalogError}</div>
                )}
                {catalogLoading && (
                  <div className="p-4 text-center text-brand-text-muted text-xs">
                    Carregando catálogo...
                  </div>
                )}
                {!catalogLoading && !catalogError && catalogResults.length === 0 && (
                  <div className="p-4 text-center text-brand-text-muted text-xs">
                    Nenhum modelo encontrado no catálogo.
                  </div>
                )}
                {!catalogLoading &&
                  catalogResults.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => applyFromCatalog(c)}
                      disabled={!editing}
                      className="w-full text-left px-3 py-2 border-b border-brand-border/50 hover:bg-secondary-container/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-brand-text truncate group-hover:text-brand-primary">
                          {c.id}
                        </span>
                        {c.provider && (
                          <span className="text-[9px] uppercase tracking-wider text-brand-text-muted shrink-0">
                            {c.provider}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-brand-text-muted">
                        <span>
                          <span className="text-on-surface-variant">in</span>{" "}
                          <span className="text-brand-text tabular-nums">
                            {formatPrice(c.inputPerMillion)}
                          </span>
                        </span>
                        <span>
                          <span className="text-on-surface-variant">out</span>{" "}
                          <span className="text-brand-text tabular-nums">
                            {formatPrice(c.outputPerMillion)}
                          </span>
                        </span>
                      </div>
                    </button>
                  ))}
              </div>

              <div className="px-3 py-2 border-t border-brand-border text-[10px] text-brand-text-muted">
                Fonte: <a
                  href="https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-primary hover:underline"
                >
                  BerriAI/litellm
                </a> · cache 1h
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 text-xs text-brand-text-muted">
            <div className="flex items-center gap-2">
              {statusBadge("priced", false)}
              <span>modelo tem preço no LiteLLM (tokscale calcula)</span>
            </div>
            <div className="flex items-center gap-2">
              {statusBadge("unmatched", false)}
              <span>sem preço no LiteLLM e sem custom com valor (custo zerado)</span>
            </div>
            <div className="flex items-center gap-2">
              {statusBadge("custom", true)}
              <span>preço definido manualmente em custom-pricing.json</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
