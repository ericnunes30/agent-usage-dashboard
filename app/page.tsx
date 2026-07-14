"use client";

import { useMemo, useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";

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

const COLORS = ["#10b981", "#3b82f6", "#a855f7", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

// Taxas hardcoded como fallback (caso a API do BCB falhe)
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

// Opção sentinela para "sem filtro" — exibida como "Todos" no select
const ALL_OPT = { value: "all", label: "Todos" };
const withAll = (items: string[]) => [ALL_OPT, ...items.map((v) => ({ value: v, label: v }))];

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return n.toString();
}

function fmtMoney(n: number, currency: string, rate: number): string {
  // Converte USD → moeda destino e formata com Intl nativo
  const converted = n * rate;
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(converted);
  } catch {
    // Fallback se a moeda for inválida
    return `${currency} ${converted.toFixed(2)}`;
  }
}

function fmtDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function fmtDateTime(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 16);
}

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
        // Recarrega os dados
        const r2 = await fetch("/api/sessions");
        const fresh = await r2.json();
        setData(fresh);
        setLastRefresh(Date.now());
        // Re-busca unmatched (a lista pode ter mudado)
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

  // Unmatched models (detectados pelo /api/refresh, editados pelo usuário)
  type Unmatched = {
    model: string;
    sessions: number;
    totalInput: number;
    totalOutput: number;
    totalTokens: number;
    exampleSessionTitle: string;
  };
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
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Busca cotação PTAX do Banco Central (USD → BRL/EUR/GBP)
  useEffect(() => {
    // Busca os últimos 5 dias úteis (pega o mais recente)
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

  // Moeda selecionada + taxas de câmbio (USD = base)
  const [currency, setCurrency] = useState<string>("BRL");
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>(FALLBACK_RATES);
  const currentRate = exchangeRates[currency] ?? FALLBACK_RATES[currency] ?? 1;

  // Valores únicos para os selects
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

  // Por cliente (para gráfico de pizza)
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
      <div className="min-h-screen flex items-center justify-center text-zinc-400">
        Carregando 1.885 sessões...
      </div>
    );
  }

  return (
    <main className="min-h-screen p-6 max-w-[1600px] mx-auto">
      <header className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Usage Dashboard</h1>
          <p className="text-zinc-500 text-sm">
            pi · claude code · codex · {data.length.toLocaleString()} sessões indexadas via tokscale
            {lastRefresh && (
              <span className="ml-2 text-zinc-600">
                · atualizado {new Date(lastRefresh).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unmatched.length > 0 && (
            <button
              onClick={() => setShowPricingModal(true)}
              className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition"
              title="Modelos com uso real mas custo = $0 (provavelmente sem preço no LiteLLM)"
            >
              ⚠ {unmatched.length} sem preço
            </button>
          )}
          <Select
            id="currency-select"
            label="Moeda"
            value={currency}
            onChange={setCurrency}
            options={CURRENCY_OPTIONS}
          />
          <button
            onClick={refresh}
            disabled={refreshing}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition"
          >
            {refreshing ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Atualizando...
              </>
            ) : (
              <>↻ Atualizar dados</>
            )}
          </button>
        </div>
      </header>

      {/* Filtros */}
      <section className="bg-surface border border-border rounded-lg p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="col-span-2">
            <label htmlFor="search-input" className="block text-xs text-zinc-500 mb-1">🔎 Buscar</label>
            <input
              id="search-input"
              name="search"
              type="text"
              placeholder="Ex: refatorar, mcp, agent-usage..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-white placeholder-zinc-600"
            />
          </div>
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
        </div>
        <div className="mt-3 text-xs text-zinc-500">
          Mostrando <span className="text-white font-semibold">{filtered.length.toLocaleString()}</span> de{" "}
          {data.length.toLocaleString()} sessões
        </div>
      </section>

      {/* KPIs */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Kpi label="Sessões" value={kpis.count.toLocaleString()} />
        <Kpi label="Custo Total" value={fmtMoney(kpis.totalCost, currency, currentRate)} accent />
        <Kpi label="Input Tokens" value={fmt(kpis.totalIn)} />
        <Kpi label="Output Tokens" value={fmt(kpis.totalOut)} />
        <Kpi label="Cache Read" value={fmt(kpis.totalCache)} />
      </section>

      {/* Gráficos */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ChartCard title={`Custo por dia (${currency})`}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={byDay}>
              <CartesianGrid stroke="#262626" />
              <XAxis dataKey="date" stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} />
              <Tooltip contentStyle={{ background: "#141414", border: "1px solid #262626" }} formatter={(v: any) => fmtMoney(Number(v), currency, currentRate)} />
              <Line type="monotone" dataKey="cost" stroke="#10b981" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={`Custo por cliente (${currency})`}>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={byClient} dataKey="cost" nameKey="name" outerRadius={90} label={(d) => d.name}>
                {byClient.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "#141414", border: "1px solid #262626" }} formatter={(v: any) => fmtMoney(Number(v), currency, currentRate)} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={`Top 10 modelos por custo (${currency})`}>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={byModel} layout="vertical">
              <CartesianGrid stroke="#262626" />
              <XAxis type="number" stroke="#71717a" fontSize={11} />
              <YAxis dataKey="name" type="category" stroke="#71717a" fontSize={10} width={140} />
              <Tooltip contentStyle={{ background: "#141414", border: "1px solid #262626" }} formatter={(v: any) => fmtMoney(Number(v), currency, currentRate)} />
              <Bar dataKey="cost" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Sessões por dia">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={byDay}>
              <CartesianGrid stroke="#262626" />
              <XAxis dataKey="date" stroke="#71717a" fontSize={11} />
              <YAxis stroke="#71717a" fontSize={11} />
              <Tooltip contentStyle={{ background: "#141414", border: "1px solid #262626" }} />
              <Bar dataKey="sessions" fill="#a855f7" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>

      {/* Tabela */}
      <section className="bg-surface border border-border rounded-lg overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Sessões ({filtered.length})</h2>
          <span className="text-xs text-zinc-500">Ordenado por mais recente</span>
        </div>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface border-b border-border">
              <tr className="text-left text-zinc-500 text-xs uppercase">
                <th className="px-4 py-3">Quando</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Workspace</th>
                <th className="px-4 py-3">Modelo</th>
                <th className="px-4 py-3 text-right">Msgs</th>
                <th className="px-4 py-3 text-right">Tokens in</th>
                <th className="px-4 py-3 text-right">Tokens out</th>
                <th className="px-4 py-3 text-right">Custo</th>
              </tr>
            </thead>
            <tbody>
              {[...filtered]
                .sort((a, b) => b.last_active - a.last_active)
                .slice(0, 500)
                .map((s) => (
                  <tr key={s.session_id} className="border-b border-border/50 hover:bg-bg/50 transition">
                    <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">{fmtDateTime(s.last_active)}</td>
                    <td className="px-4 py-3">
                      <ClientBadge client={s.client} />
                    </td>
                    <td className="px-4 py-3 text-white">{s.workspace_label}</td>
                    <td className="px-4 py-3 text-zinc-400 font-mono text-xs">
                      {s.models_used.join(", ")}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-300">{s.message_count}</td>
                    <td className="px-4 py-3 text-right text-zinc-300">{fmt(s.total_input_tokens)}</td>
                    <td className="px-4 py-3 text-right text-zinc-300">{fmt(s.total_output_tokens)}</td>
                    <td className="px-4 py-3 text-right text-emerald-400 font-mono">{fmtMoney(s.total_cost, currency, currentRate)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && (
          <div className="p-3 text-xs text-zinc-500 text-center border-t border-border">
            Mostrando 500 de {filtered.length.toLocaleString()} sessões
          </div>
        )}
      </section>

      {showPricingModal && (
        <PricingModal
          unmatched={unmatched}
          onClose={() => setShowPricingModal(false)}
          onSaved={() => {
            setShowPricingModal(false);
            // Recarrega sessions pra aplicar o novo override
            fetch("/api/sessions")
              .then((r) => r.json())
              .then((d) => { setData(d); fetchUnmatched(); });
          }}
        />
      )}
    </main>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={"text-2xl font-bold " + (accent ? "text-emerald-400" : "text-white")}>{value}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-zinc-300 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function ClientBadge({ client }: { client: string }) {
  const colors: Record<string, string> = {
    pi: "bg-emerald-500/20 text-emerald-300",
    claude: "bg-orange-500/20 text-orange-300",
    codex: "bg-blue-500/20 text-blue-300",
    droid: "bg-purple-500/20 text-purple-300",
    gemini: "bg-cyan-500/20 text-cyan-300",
    opencode: "bg-pink-500/20 text-pink-300",
    amp: "bg-yellow-500/20 text-yellow-300",
    kilo: "bg-red-500/20 text-red-300",
  };
  return (
    <span className={"px-2 py-0.5 rounded text-xs font-medium " + (colors[client] ?? "bg-zinc-700 text-zinc-300")}>
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
    <div>
      <label htmlFor={id} className="block text-xs text-zinc-500 mb-1">{label}</label>
      <select
        id={id}
        name={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-bg border border-border rounded px-2 py-2 text-sm text-white"
      >
        {options.map((opt) => {
          const v = typeof opt === "string" ? opt : opt.value;
          const l = typeof opt === "string" ? opt : opt.label;
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
    </div>
  );
}

type Unmatched = {
  model: string;
  sessions: number;
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  exampleSessionTitle: string;
};

function PricingModal({
  unmatched,
  onClose,
  onSaved,
}: {
  unmatched: Unmatched[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Estado: modelo → { input, output }
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
        className="bg-surface border border-border rounded-lg w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Modelos sem preço ({unmatched.length})
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Defina o preço em USD por <strong>1 milhão</strong> de tokens. Use 0 para modelos locais/free.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white text-xl px-2"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {unmatched.length === 0 ? (
            <div className="text-zinc-500 text-sm text-center py-8">
              Nenhum modelo sem preço detectado. 🎉
            </div>
          ) : (
            <div className="space-y-2">
              {unmatched.map((u) => (
                <div
                  key={u.model}
                  className="bg-bg border border-border rounded p-3 flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm text-white truncate" title={u.model}>
                      {u.model}
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {u.sessions} sessão(ões) · {fmt(u.totalInput)} in · {fmt(u.totalOutput)} out
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div>
                      <label
                        htmlFor={`in-${u.model}`}
                        className="block text-[10px] text-zinc-500 mb-0.5"
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
                        className="w-24 bg-surface border border-border rounded px-2 py-1 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`out-${u.model}`}
                        className="block text-[10px] text-zinc-500 mb-0.5"
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
                        className="w-24 bg-surface border border-border rounded px-2 py-1 text-sm text-white"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {err && (
          <div className="px-4 py-2 bg-red-900/30 border-t border-red-900/50 text-red-300 text-sm">
            {err}
          </div>
        )}

        <div className="p-4 border-t border-border flex items-center justify-between">
          <span className="text-xs text-zinc-500">
            Salvo em <code className="text-zinc-400">data/custom-pricing.json</code>
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={saving || unmatched.length === 0}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2 rounded text-sm font-medium"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
