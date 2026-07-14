"use client";

import { useMemo, useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import Sidebar from "./components/Sidebar";

// ============ Types ============

type Session = {
  session_id: string;
  client: string;
  workspace: string;
  workspace_label: string;
  created_at: number;
  last_active: number;
  title: string;
  task_category: string;
  description: string;
  complexity: string;
  task_group: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read: number;
  total_cost: number;
  models_used: string[];
  message_count: number;
  duration_minutes: number;
  summarized_at: number;
  fm_version: string | null;
};

type Unmatched = {
  model: string;
  sessions: number;
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  exampleSessionTitle: string;
};

// ============ Constants ============

const COLORS = ["#10b981", "#3b82f6", "#a855f7", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  BRL: 5.43,
  EUR: 0.92,
  GBP: 0.79,
};

const CURRENCY_OPTIONS = [
  { value: "BRL", label: "BRL (R$)" },
  { value: "USD", label: "USD ($)" },
  { value: "EUR", label: "EUR (€)" },
  { value: "GBP", label: "GBP (£)" },
];

const ALL_OPT = { value: "all", label: "Todos" };
const withAll = (items: string[]) => [ALL_OPT, ...items.map((v) => ({ value: v, label: v }))];

// ============ Helpers ============

function fmt(n: number): string {
  // Formato brasileiro: número completo com pontos como separador de milhar
  // + sufixo de escala (bi/mi) no final para identificação rápida
  const formatted = new Intl.NumberFormat("pt-BR").format(n);
  if (n >= 1_000_000_000) return formatted + " bi";
  if (n >= 1_000_000) return formatted + " mi";
  return formatted;
}

function fmtMoney(n: number, currency: string, rate: number): string {
  const converted = n * rate;
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(converted);
  } catch {
    return `${currency} ${converted.toFixed(2)}`;
  }
}

function fmtDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function fmtDateTime(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 16);
}

// ============ Main Component ============

export default function Page() {
  const [data, setData] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);

  async function refresh() {
    setRefreshing(true);
    try {
      const r = await fetch("/api/refresh", { method: "POST" });
      const result = await r.json();
      if (result.ok) {
        const r2 = await fetch("/api/sessions", { cache: "no-store" });
        const fresh = await r2.json();
        setData(fresh);
        setLastRefresh(Date.now());
        fetchUnmatched();
      } else {
        alert("Erro ao atualizar: " + result.error);
      }
    } catch (e: any) {
      alert("Erro: " + e.message);
    } finally {
      setRefreshing(false);
    }
  }

  // Unmatched models
  const [unmatched, setUnmatched] = useState<Unmatched[]>([]);
  const [showPricingModal, setShowPricingModal] = useState(false);

  async function fetchUnmatched() {
    try {
      const r = await fetch("/api/unmatched");
      const data = await r.json();
      setUnmatched(Array.isArray(data) ? data : []);
    } catch {
      setUnmatched([]);
    }
  }

  useEffect(() => {
    fetchUnmatched();
  }, []);

  // Filtros
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [workspaceFilter, setWorkspaceFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [daysBack, setDaysBack] = useState<number>(0); // 0 = tudo

  useEffect(() => {
    fetch("/api/sessions", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Busca cotação PTAX do Banco Central (USD → BRL)
  useEffect(() => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 7);
    const fmtBCB = (d: Date) =>
      `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;
    const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='${fmtBCB(start)}'&@dataFinalCotacao='${fmtBCB(today)}'&$top=1&$orderby=dataHoraCotacao%20desc&$format=json&$select=cotacaoCompra`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        const usdBrl = d?.value?.[0]?.cotacaoCompra;
        if (typeof usdBrl === "number" && usdBrl > 0) {
          setExchangeRates((prev) => ({ ...prev, BRL: usdBrl }));
        }
      })
      .catch(() => {/* mantém fallback */});
  }, []);

  // Moeda + taxas
  const [currency, setCurrency] = useState<string>("BRL");
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>(FALLBACK_RATES);
  const currentRate = exchangeRates[currency] ?? FALLBACK_RATES[currency] ?? 1;

  // Valores únicos para selects
  const clients = useMemo(() => Array.from(new Set(data.map((s) => s.client))).sort(), [data]);
  const workspaces = useMemo(
    () => Array.from(new Set(data.map((s) => s.workspace_label))).sort(),
    [data]
  );
  const models = useMemo(
    () => Array.from(new Set(data.flatMap((s) => s.models_used))).sort(),
    [data]
  );

  // Dados filtrados
  const filtered = useMemo(() => {
    const cutoff = daysBack > 0 ? Date.now() - daysBack * 86_400_000 : 0;
    return data.filter((s) => {
      if (clientFilter !== "all" && s.client !== clientFilter) return false;
      if (workspaceFilter !== "all" && s.workspace_label !== workspaceFilter) return false;
      if (modelFilter !== "all" && !s.models_used.includes(modelFilter)) return false;
      if (cutoff && s.last_active < cutoff) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !s.title.toLowerCase().includes(q) &&
          !s.description.toLowerCase().includes(q) &&
          !s.workspace_label.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [data, clientFilter, workspaceFilter, modelFilter, search, daysBack]);

  // KPIs
  const kpis = useMemo(() => {
    const totalCost = filtered.reduce((a, s) => a + s.total_cost, 0);
    const totalIn = filtered.reduce((a, s) => a + s.total_input_tokens, 0);
    const totalOut = filtered.reduce((a, s) => a + s.total_output_tokens, 0);
    const totalCache = filtered.reduce((a, s) => a + s.total_cache_read, 0);
    const totalMsgs = filtered.reduce((a, s) => a + s.message_count, 0);
    return { totalCost, totalIn, totalOut, totalCache, totalMsgs, count: filtered.length };
  }, [filtered]);

  // Por cliente (pizza)
  const byClient = useMemo(() => {
    const m = new Map<string, { cost: number; sessions: number; tokens: number }>();
    for (const s of filtered) {
      const cur = m.get(s.client) ?? { cost: 0, sessions: 0, tokens: 0 };
      cur.cost += s.total_cost;
      cur.sessions += 1;
      cur.tokens += s.total_input_tokens + s.total_output_tokens;
      m.set(s.client, cur);
    }
    return Array.from(m.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.cost - a.cost);
  }, [filtered]);

  // Por modelo (top 10)
  const byModel = useMemo(() => {
    const m = new Map<string, { cost: number; sessions: number }>();
    for (const s of filtered) {
      for (const model of s.models_used) {
        const cur = m.get(model) ?? { cost: 0, sessions: 0 };
        cur.cost += s.total_cost / s.models_used.length;
        cur.sessions += 1;
        m.set(model, cur);
      }
    }
    return Array.from(m.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);
  }, [filtered]);

  // Por dia (série temporal)
  const byDay = useMemo(() => {
    const m = new Map<string, { cost: number; sessions: number; tokens: number }>();
    for (const s of filtered) {
      const day = fmtDate(s.created_at);
      const cur = m.get(day) ?? { cost: 0, sessions: 0, tokens: 0 };
      cur.cost += s.total_cost;
      cur.sessions += 1;
      cur.tokens += s.total_input_tokens + s.total_output_tokens;
      m.set(day, cur);
    }
    return Array.from(m.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-bg text-brand-text-muted font-sans">
        <div className="flex flex-col items-center gap-3">
          <span className="material-symbols-outlined text-4xl text-brand-primary animate-pulse">analytics</span>
          <span>Carregando sessões...</span>
        </div>
      </div>
    );
  }

  const tooltipStyle = {
    background: "#1e1f26",
    border: "1px solid #3c4a42",
    borderRadius: "8px",
    color: "#e2e1eb",
    fontSize: "13px",
  };

  return (
    <div className="flex min-h-screen bg-brand-bg text-brand-text font-sans">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <main className="flex-grow flex flex-col min-h-screen md:w-[calc(100%-16rem)]">
        {/* Header */}
        <header className="flex justify-between items-center w-full px-4 md:px-8 py-4 sticky top-0 z-50 bg-brand-bg/95 backdrop-blur border-b border-brand-border">
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold text-brand-primary leading-tight tracking-tight">Usage Dashboard</h1>
            <p className="text-sm text-brand-text-muted mt-0.5">
              pi · claude code · codex · {data.length.toLocaleString()} sessões indexadas via tokscale
              {lastRefresh && (
                <span className="ml-2 text-brand-text-muted/60">
                  · atualizado {new Date(lastRefresh).toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {unmatched.length > 0 && (
              <button
                onClick={() => setShowPricingModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-950 border border-amber-600/30 text-amber-400 text-sm hover:bg-amber-900/50 transition-colors"
                title="Modelos com uso real mas custo = $0 (provavelmente sem preço no LiteLLM)"
              >
                <span className="text-sm">⚠</span>
                {unmatched.length} sem preço
              </button>
            )}
            {/* Currency selector */}
            <div className="relative">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="appearance-none bg-brand-bg border border-brand-border text-brand-text text-sm rounded-md pl-3 pr-8 py-1.5 focus:outline-none focus:border-brand-border-hover focus:ring-1 focus:ring-brand-border-hover cursor-pointer hover:border-brand-border-hover transition-colors"
              >
                {CURRENCY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-brand-text-muted">
                <span className="material-symbols-outlined text-[16px]">expand_more</span>
              </div>
            </div>
            {/* Refresh button */}
            <button
              onClick={refresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-1.5 rounded-md bg-brand-primary text-black text-sm font-semibold hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 transition-colors"
            >
              {refreshing ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  Atualizando...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[16px] text-black">refresh</span>
                  Atualizar dados
                </>
              )}
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-grow px-4 md:px-8 py-4 max-w-[1440px] mx-auto w-full flex flex-col gap-4">
          {/* Filters */}
          <section className="bg-brand-surface border border-brand-border rounded-lg p-3 flex flex-col md:flex-row gap-4 items-end">
            {/* Search */}
            <div className="w-full md:w-64 shrink-0">
              <label htmlFor="search-input" className="block text-xs font-semibold uppercase tracking-wider text-brand-text-muted mb-1">Buscar</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <span className="material-symbols-outlined text-brand-text-muted text-[16px]">search</span>
                </div>
                <input
                  id="search-input"
                  name="search"
                  type="text"
                  placeholder="Ex: refatorar, mcp, agent-usage..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-brand-bg border border-brand-border text-brand-text text-sm rounded-md pl-9 pr-3 py-2 focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary transition-colors placeholder-brand-text-muted"
                />
              </div>
            </div>
            {/* Selects */}
            <Select id="client-filter" label="Agente" value={clientFilter} onChange={setClientFilter} options={withAll(clients)} />
            <Select id="workspace-filter" label="Workspace" value={workspaceFilter} onChange={setWorkspaceFilter} options={withAll(workspaces.slice(0, 50))} />
            <Select id="model-filter" label="Modelo" value={modelFilter} onChange={setModelFilter} options={withAll(models)} />
            <Select
              id="period-filter"
              label="Período"
              value={String(daysBack)}
              onChange={(v) => setDaysBack(Number(v))}
              options={[
                { value: "0", label: "Tudo" },
                { value: "1", label: "Hoje" },
                { value: "7", label: "7 dias" },
                { value: "30", label: "30 dias" },
                { value: "90", label: "90 dias" },
              ]}
            />
            <div className="text-xs text-brand-text-muted ml-auto pb-2 whitespace-nowrap">
              <span className="text-brand-text font-semibold">{filtered.length.toLocaleString()}</span> de {data.length.toLocaleString()} sessões
            </div>
          </section>

          {/* KPIs */}
          <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Kpi label="Sessões" value={kpis.count.toLocaleString()} />
            <Kpi label="Custo Total" value={fmtMoney(kpis.totalCost, currency, currentRate)} accent />
            <Kpi label="Input Tokens" value={fmt(kpis.totalIn)} />
            <Kpi label="Output Tokens" value={fmt(kpis.totalOut)} />
            <Kpi label="Cache Read" value={fmt(kpis.totalCache)} />
          </section>

          {/* Charts */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title={`Custo por dia (${currency})`}>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={byDay}>
                  <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#a1a1aa" fontSize={11} />
                  <YAxis stroke="#a1a1aa" fontSize={11} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtMoney(Number(v), currency, currentRate)} />
                  <Line type="monotone" dataKey="cost" stroke="#10b981" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={`Custo por agente (${currency})`}>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={byClient} dataKey="cost" nameKey="name" outerRadius={90} label={(d) => d.name}>
                    {byClient.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtMoney(Number(v), currency, currentRate)} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title={`Top 10 modelos por custo (${currency})`}>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={byModel} layout="vertical">
                  <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                  <XAxis type="number" stroke="#a1a1aa" fontSize={11} />
                  <YAxis dataKey="name" type="category" stroke="#a1a1aa" fontSize={10} width={140} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtMoney(Number(v), currency, currentRate)} />
                  <Bar dataKey="cost" fill="#0566d9" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Sessões por dia">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={byDay}>
                  <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#a1a1aa" fontSize={11} />
                  <YAxis stroke="#a1a1aa" fontSize={11} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="sessions" fill="#c487ff" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </section>

          {/* Table */}
          <section className="bg-brand-surface border border-brand-border rounded-lg overflow-hidden">
            <div className="p-4 border-b border-brand-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-brand-text">Sessões ({filtered.length})</h2>
              <span className="text-xs text-brand-text-muted">Ordenado por mais recente</span>
            </div>
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto no-scrollbar">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-brand-surface border-b border-brand-border z-10">
                  <tr className="text-left">
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-brand-text-muted">Quando</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-brand-text-muted">Agente</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-brand-text-muted">Workspace</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-brand-text-muted">Modelo</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-brand-text-muted text-right">Msgs</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-brand-text-muted text-right">Tokens in</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-brand-text-muted text-right">Tokens out</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-brand-text-muted text-right">Custo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border/50">
                  {[...filtered]
                    .sort((a, b) => b.last_active - a.last_active)
                    .slice(0, 500)
                    .map((s) => (
                      <tr key={s.session_id} className="hover:bg-brand-border/20 transition-colors">
                        <td className="px-4 py-2.5 text-brand-text-muted whitespace-nowrap">{fmtDateTime(s.last_active)}</td>
                        <td className="px-4 py-2.5"><ClientBadge client={s.client} /></td>
                        <td className="px-4 py-2.5 text-brand-text">{s.workspace_label}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-brand-text-muted">{s.models_used.join(", ")}</td>
                        <td className="px-4 py-2.5 text-right text-brand-text">{s.message_count}</td>
                        <td className="px-4 py-2.5 text-right text-brand-text-muted">{fmt(s.total_input_tokens)}</td>
                        <td className="px-4 py-2.5 text-right text-brand-text-muted">{fmt(s.total_output_tokens)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm text-brand-primary">{fmtMoney(s.total_cost, currency, currentRate)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {filtered.length > 500 && (
              <div className="p-3 text-xs text-brand-text-muted text-center border-t border-brand-border">
                Mostrando 500 de {filtered.length.toLocaleString()} sessões
              </div>
            )}
          </section>
        </div>
      </main>

      {showPricingModal && (
        <PricingModal
          unmatched={unmatched}
          onClose={() => setShowPricingModal(false)}
          onSaved={() => {
            setShowPricingModal(false);
            fetch("/api/sessions", { cache: "no-store" })
              .then((r) => r.json())
              .then((d) => { setData(d); fetchUnmatched(); });
          }}
        />
      )}
    </div>
  );
}

// ============ Sub-components ============

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`bg-brand-surface border border-brand-border rounded-lg p-4 flex flex-col justify-between ${accent ? "ring-1 ring-brand-primary/20 bg-brand-primary/5" : ""}`}>
      <span className="text-xs font-semibold uppercase tracking-wider text-brand-text-muted">{label}</span>
      <span className={`text-2xl font-semibold mt-2 ${accent ? "text-brand-primary" : "text-brand-text"}`}>{value}</span>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-brand-surface border border-brand-border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-brand-text mb-3">{title}</h3>
      {children}
    </div>
  );
}

function ClientBadge({ client }: { client: string }) {
  const colors: Record<string, string> = {
    pi: "bg-emerald-950/40 text-emerald-400 border-emerald-800/50",
    claude: "bg-orange-950/40 text-orange-400 border-orange-800/50",
    codex: "bg-blue-950/40 text-blue-400 border-blue-800/50",
    droid: "bg-purple-950/40 text-purple-400 border-purple-800/50",
    gemini: "bg-cyan-950/40 text-cyan-400 border-cyan-800/50",
    opencode: "bg-pink-950/40 text-pink-400 border-pink-800/50",
    amp: "bg-yellow-950/40 text-yellow-400 border-yellow-800/50",
    kilo: "bg-red-950/40 text-red-400 border-red-800/50",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colors[client] ?? "bg-zinc-800 text-zinc-300 border-zinc-700"}`}>
      {client}
    </span>
  );
}

function Select({
  label, value, onChange, options, id,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: (string | { value: string; label: string })[];
  id: string;
}) {
  return (
    <div className="flex-grow">
      <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-wider text-brand-text-muted mb-1">{label}</label>
      <div className="relative">
        <select
          id={id}
          name={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none bg-brand-bg border border-brand-border text-brand-text text-sm rounded-md pl-3 pr-8 py-2 focus:outline-none focus:border-brand-border-hover focus:ring-1 focus:ring-brand-border-hover cursor-pointer hover:border-brand-border-hover transition-colors"
        >
          {options.map((opt) => {
            const v = typeof opt === "string" ? opt : opt.value;
            const l = typeof opt === "string" ? opt : opt.label;
            return <option key={v} value={v}>{l}</option>;
          })}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-brand-text-muted">
          <span className="material-symbols-outlined text-[16px]">expand_more</span>
        </div>
      </div>
    </div>
  );
}

function PricingModal({
  unmatched,
  onClose,
  onSaved,
}: {
  unmatched: Unmatched[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [prices, setPrices] = useState<Record<string, { input: string; output: string }>>(() => {
    const init: Record<string, { input: string; output: string }> = {};
    for (const u of unmatched) {
      init[u.model] = { input: "0", output: "0" };
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function setPrice(model: string, field: "input" | "output", value: string) {
    setPrices((prev) => ({
      ...prev,
      [model]: { ...(prev[model] ?? { input: "0", output: "0" }), [field]: value },
    }));
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const overrides = Object.entries(prices)
        .map(([model, p]) => ({
          model,
          inputPerMillion: Number(p.input),
          outputPerMillion: Number(p.output),
        }))
        .filter((o) => !isNaN(o.inputPerMillion) && !isNaN(o.outputPerMillion));

      const r = await fetch("/api/unmatched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      const result = await r.json();
      if (!r.ok || !result.ok) throw new Error(result.error ?? "Erro desconhecido");
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-container-high border border-outline-variant rounded-lg w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-brand-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-brand-text">
              Modelos sem preço ({unmatched.length})
            </h2>
            <p className="text-xs text-brand-text-muted mt-0.5">
              Defina o preço em USD por <strong>1 milhão</strong> de tokens. Use 0 para modelos locais/free.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-brand-text-muted hover:text-brand-text text-xl px-2"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {unmatched.length === 0 ? (
            <div className="text-brand-text-muted text-sm text-center py-8">
              Nenhum modelo sem preço detectado. 🎉
            </div>
          ) : (
            <div className="space-y-2">
              {unmatched.map((u) => (
                <div
                  key={u.model}
                  className="bg-brand-bg border border-brand-border rounded p-3 flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm text-brand-text truncate" title={u.model}>
                      {u.model}
                    </div>
                    <div className="text-xs text-brand-text-muted mt-0.5">
                      {u.sessions} sessão(ões) · {fmt(u.totalInput)} in · {fmt(u.totalOutput)} out
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div>
                      <label
                        htmlFor={`in-${u.model}`}
                        className="block text-[10px] text-brand-text-muted mb-0.5"
                      >
                        Input $/M
                      </label>
                      <input
                        id={`in-${u.model}`}
                        type="number"
                        step="0.0001"
                        min="0"
                        value={prices[u.model]?.input ?? "0"}
                        onChange={(e) => setPrice(u.model, "input", e.target.value)}
                        className="w-24 bg-brand-surface border border-brand-border rounded px-2 py-1 text-sm text-brand-text"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`out-${u.model}`}
                        className="block text-[10px] text-brand-text-muted mb-0.5"
                      >
                        Output $/M
                      </label>
                      <input
                        id={`out-${u.model}`}
                        type="number"
                        step="0.0001"
                        min="0"
                        value={prices[u.model]?.output ?? "0"}
                        onChange={(e) => setPrice(u.model, "output", e.target.value)}
                        className="w-24 bg-brand-surface border border-brand-border rounded px-2 py-1 text-sm text-brand-text"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {err && (
          <div className="px-4 py-2 bg-red-950/30 border-t border-red-900/50 text-red-400 text-sm">
            {err}
          </div>
        )}

        <div className="p-4 border-t border-brand-border flex items-center justify-between">
          <span className="text-xs text-brand-text-muted">
            Salvo em <code className="text-brand-text-muted/80">data/custom-pricing.json</code>
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-brand-text-muted hover:text-brand-text"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={saving || unmatched.length === 0}
              className="bg-brand-primary text-black hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 px-4 py-2 rounded text-sm font-medium transition-colors"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}