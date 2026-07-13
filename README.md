# 📊 AI Usage Dashboard

> Local-first dashboard to visualize token usage and costs across AI coding agents (pi, Claude Code, Codex, Gemini, etc).

![Status](https://img.shields.io/badge/status-MVP-yellow)
![License](https://img.shields.io/badge/license-MIT-blue)
![Stack](https://img.shields.io/badge/stack-Next.js_14_+_React_18_+_Recharts-black)

## What is this?

A self-hosted web dashboard that reads your local AI agent session logs and shows:

- 💰 **Cost breakdown** by agent, model, day, workspace
- 📈 **Token usage** (input, output, cache) over time
- 🔍 **Per-session exploration** with full-text search
- 🎯 **Granular filters** by client, workspace, model, date range
- 📊 **Visualizations**: line, pie, bar charts + sortable table

## ✨ Features

- **Multi-agent support** — pi, Claude Code, Codex, Gemini CLI, Droid, OpenCode, Amp, Kilo
- **Session-level granularity** — every individual conversation is a first-class data point
- **Dark mode** by default
- **Responsive layout** (works on narrow terminals / mobile)
- **Fast** — 1.4MB JSON of 1.887 sessions loads in <100ms
- **Local-first** — your data never leaves your machine

## 💰 About the costs shown here

**You don't need to register or configure anything** — the costs are computed automatically by [`tokscale`](https://github.com/junhoyelo/tokscale) using the [LiteLLM pricing database](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) (2,963 models catalogued). The pipeline:

```
Your agent log → model name (e.g. "minimax-m3:cloud")
       ↓
Tokscale: "lookup in LiteLLM pricing"
       ↓
Match: fireworks_ai/minimax-m3, openrouter/..., bedrock/..., etc.
       ↓
cost = input_tokens × input_price + output_tokens × output_price + cache_read × cache_price
```

**This means the cost numbers are estimates**, not invoices. They are useful for trends and comparisons, but the actual amount you pay depends on the provider you use:

| Situation | Accuracy of cost shown |
|---|---|
| Official OpenAI / Anthropic / Google direct | ✅ Very accurate (official pricing) |
| OpenRouter / LiteLLM proxy | ⚠️ Approximate (depends on routing) |
| Self-hosted or aggregator with custom pricing | ❌ May be wrong (fallback to closest match) |
| Models not in LiteLLM | ❌ Often shows $0.00 (no match found) |

> 💡 **Bottom line:** the dashboard is great for answering *"which model am I using the most?"* and *"where are tokens going?"*. For the real bill, check your provider's dashboard. The cache_read column is especially noisy across non-Anthropic providers.

## 🏗️ Architecture

```
Local files (read-only)              Data pipeline              Frontend
─────────────────────────           ─────────────────          ──────────────
~/.pi/agent/sessions/*.jsonl   ┐
~/.claude/projects/*.jsonl     ├──>  npx tokscale --json  ──>  data/sessions.json
~/.codex/sessions/*.jsonl      │    (run manually or
~/.gemini/tmp/*/chats/         ┘     via API endpoint)
                                       │
                                       ▼
                              ┌────────────────────┐
                              │  Next.js API route  │  ← 19 lines, just reads the file
                              │  /api/sessions      │
                              └──────────┬─────────┘
                                         │
                                         ▼
                              ┌────────────────────┐
                              │  React + Recharts   │  ← 540 lines, all custom UI
                              │  / (dashboard)      │
                              └────────────────────┘
```

## 📝 About the code

This project is **100% custom code** — 540 lines written from scratch across 5 files:

| File | Lines | Purpose |
|------|------:|---------|
| `app/page.tsx` | 431 | UI: filters, KPIs, 4 charts, table |
| `app/api/refresh/route.ts` | 52 | Re-runs tokscale via child_process |
| `app/globals.css` | 23 | Dark theme + scrollbar |
| `app/layout.tsx` | 15 | HTML root |
| `app/api/sessions/route.ts` | 19 | JSON file reader |

**Dependencies** (`package.json`) are generic libraries, not project-specific code:
- `next` / `react` — framework
- `recharts` — charting
- `tailwindcss` — styling
- `date-fns` — date utilities
- `clsx` — className helper

## 🚀 Quick start

```bash
# 1. Install dependencies
bun install

# 2. Generate the sessions data file
npx tokscale@latest report --no-summarize --json > data/sessions.json

# 3. Run the dev server
bun run dev

# 4. Open http://localhost:3000
```

## 📋 Prerequisites

- **Node.js 18+** or **Bun 1.2+**
- **[`tokscale`](https://github.com/junhoyeo/tokscale)** for generating the data file (`npx tokscale@latest`)
- Local session data from at least one of the supported agents

## 🎯 Use case

Built for developers who use multiple AI coding agents daily and want to:

1. **See where tokens are going** — which model, which project, which day
2. **Compare costs** — is Claude Sonnet cheaper than DeepSeek for this task?
3. **Track productivity** — how many sessions per day, how long do they run
4. **Find expensive sessions** — drill down to outliers

## ⚠️ Limitations (current MVP)

- **Data is static** — you must re-run `tokscale` to refresh (no auto-watch yet)
- **5-minute browser cache** — fast refresh may show stale data
- **Filters reset on page reload** — no localStorage persistence yet
- **No auth** — local-only, do not expose publicly

## 🛣️ Roadmap

- [x] "Refresh data" button (re-runs tokscale via API) ✨
- [ ] File watcher (auto-detect new sessions)
- [ ] Persistent filters (localStorage)
- [ ] Session detail page (read the actual JSONL messages)
- [ ] Export filtered data to CSV/JSON
- [ ] Dark/light theme toggle

## 🧪 Tech stack

- **Framework:** Next.js 14 (App Router)
- **UI:** React 18, Tailwind CSS 3
- **Charts:** Recharts 2.13
- **Data source:** [`tokscale`](https://github.com/junhoyeo/tokscale) (Rust CLI, powered by [LiteLLM pricing](https://github.com/BerriAI/litellm))
- **Package manager:** Bun (npm/yarn/pnpm also work)

> ⚠️ **Note:** Recharts 2.x is not compatible with React 19, so this project pins to React 18. If you want React 19, upgrade to Recharts 3.x.

## 📄 License

MIT
