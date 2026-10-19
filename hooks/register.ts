import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Effort, Mode, Route, Spend, Tier } from '../types'

// ── Modelle ────────────────────────────────────────────────────────────────

export const MODELS: Record<Tier, { id: string; label: string }> = {
  fable: { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  opus: { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  sonnet: { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  haiku: { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
}

const TIERS: readonly Tier[] = ['fable', 'opus', 'sonnet', 'haiku']

// ── Listenpreise USD / MTok, Stand Oktober 2026 ───────────────────────────
// Reihenfolge zählt: das erste Muster, das auf die Model-ID passt, gewinnt.

type Price = { in: number; hit: number; out: number }

const PRICES: readonly [RegExp, Price, Price?][] = [
  [/fable-5-1|mythos-5-1/, { in: 10, hit: 0.25, out: 50 }],
  [/fable|mythos/, { in: 10, hit: 1, out: 50 }],
  [/opus-5-5/, { in: 4, hit: 0.2, out: 20 }],
  [/opus-4-1|opus-4-0|opus-4-2|opus-3/, { in: 15, hit: 1.5, out: 75 }],
  [/opus/, { in: 5, hit: 0.5, out: 25 }],
  [/sonnet-5-5/, { in: 2, hit: 0.1, out: 10 }],
  [/sonnet-5/, { in: 2, hit: 0.2, out: 10 }],
  [/sonnet/, { in: 3, hit: 0.3, out: 15 }],
  // Haiku 5.5: Prompts über 100k Tokens laufen auf dem höheren Satz.
  [/haiku-5-5/, { in: 0.1, hit: 0.01, out: 0.5 }, { in: 0.5, hit: 0.05, out: 2.5 }],
  [/haiku/, { in: 1, hit: 0.1, out: 5 }],
]

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** Dollar für eine Antwort; 5-Minuten-Cache-Writes zu 1,25× Input. Unbekanntes Modell: 0. */
export function priceOf(model: string, u: Usage): number {
  const row = PRICES.find(([re]) => re.test(model))
  if (!row) return 0
  const prompt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const p = prompt > 100_000 && row[2] ? row[2] : row[1]
  return (
    (u.input_tokens * p.in +
      u.cache_creation_input_tokens * p.in * 1.25 +
      u.cache_read_input_tokens * p.hit +
      u.output_tokens * p.out) /
    1e6
  )
}

// ── Routing ────────────────────────────────────────────────────────────────

const SIGNALS: Record<Tier, readonly string[]> = {
  fable: [
    'deep research', 'deep dive', 'recherchier', 'mehrstünd', 'stundenlang', 'umfassend',
    'comprehensive', 'whitepaper', 'entscheidungsvorlage', 'end-to-end', 'from scratch',
    'komplett neu', 'gesamte codebase', 'long-running',
  ],
  opus: [
    'refactor', 'migrier', 'migrat', 'architekt', 'architect', 'konzept', 'root cause',
    'ursache', 'incident', 'postmortem', 'debug', 'performance', 'optimier', 'security',
    'sicherheit', 'threat model', 'autonom', 'autonomous', 'multi-repo', 'mehrere repos',
    'codebase', 'trade-off', 'tradeoff', 'abwäg', 'strategie', 'operator', 'crossplane',
    'race condition', 'deadlock', 'design doc',
  ],
  sonnet: [
    'implementier', 'implement', 'schreib', 'write', 'code', 'funktion', 'function',
    'test', 'fix', 'bug', 'script', 'skript', 'review', 'erklär', 'explain', 'analys',
    'helm', 'terraform', 'yaml', 'dockerfile', 'query', 'sql', 'pipeline', 'mail',
    'e-mail', 'dokument', 'präsentation', 'deck',
  ],
  haiku: [
    'klassifizier', 'classify', 'kategorisier', 'extrahier', 'extract', 'übersetz',
    'translate', 'formatier', 'format as', 'umbenenn', 'rename', 'tippfehler', 'typo',
    'rechtschreib', 'grammatik', 'kurz:', 'quick', 'regex', 'json', 'was ist', 'what is',
    'wie heißt', 'definier', 'liste auf', 'tl;dr', 'tldr', 'einzeiler', 'one-liner',
  ],
}

const HINT = /(^|\s)@(fable|opus|sonnet|haiku)\b/i

export type Decision = Route & { stripped: string }

/** Wählt Modell und Effort für einen Prompt; `previous` trägt kurze Folge-Prompts weiter. */
export function decide(text: string, previous: Route | null): Decision {
  const hint = text.match(HINT)
  if (hint) {
    const tier = hint[2].toLowerCase() as Tier
    const stripped = text.replace(HINT, ' ').trim()
    return { tier, effort: defaultEffort(tier, 2), reason: '@' + tier, stripped }
  }

  const s = text.toLowerCase()
  const score: Record<Tier, number> = { fable: 0, opus: 0, sonnet: 0.5, haiku: 0 }
  const hits: Record<Tier, string[]> = { fable: [], opus: [], sonnet: [], haiku: [] }
  for (const tier of TIERS) {
    for (const w of SIGNALS[tier]) {
      if (s.includes(w)) {
        score[tier] += 1
        hits[tier].push(w)
      }
    }
  }
  if (text.length > 600) score.opus += 1
  if (text.length > 1500) score.fable += 1
  if (text.length < 120 && hits.opus.length === 0 && hits.fable.length === 0) score.haiku += 0.25

  const signalled = TIERS.some(t => hits[t].length > 0)
  if (!signalled && text.trim().length < 40 && previous) {
    return { ...previous, reason: 'Folge-Prompt', stripped: text }
  }

  // Bei Gleichstand: Sonnet vor Opus vor Haiku vor Fable.
  const tier = (['sonnet', 'opus', 'haiku', 'fable'] as const).reduce((a, b) =>
    score[b] > score[a] ? b : a,
  )
  const reason = hits[tier].slice(0, 3).join(', ') || 'Standard'
  return { tier, effort: defaultEffort(tier, score[tier]), reason, stripped: text }
}

function defaultEffort(tier: Tier, score: number): Effort {
  switch (tier) {
    case 'haiku':
      return 'low'
    case 'sonnet':
      return score >= 2.5 ? 'high' : 'medium'
    case 'opus':
      return score >= 3 ? 'high' : 'medium'
    case 'fable':
      return 'high'
  }
}

// ── Zustand ────────────────────────────────────────────────────────────────

const mode = atom({ plugin: 'model-router', key: 'mode' } as const, 'auto' as Mode)
const route = atom({ plugin: 'model-router', key: 'route' } as const, null as Route | null)
const emptySpend: Spend = { total: 0, byModel: {}, lastTurn: 0, requests: 0 }
const spend = atom({ plugin: 'model-router', key: 'spend' } as const, emptySpend)

const usd = (v: number) => (v < 0.01 && v > 0 ? '<$0.01' : '$' + v.toFixed(2))

function labelOf(modelId: string): string {
  const tier = TIERS.find(t => modelId.includes(t))
  return tier ? MODELS[tier].label.split(' ')[0] : modelId
}

async function paint($: EngineInterface) {
  const [m, r, sp] = await Promise.all([read($, mode), read($, route), read($, spend)])
  const head =
    m === 'off'
      ? 'Router aus'
      : r
        ? `${MODELS[r.tier].label} · ${r.effort}${m !== 'auto' ? ' (fix)' : ''} · ${r.reason}`
        : 'Router bereit'
  const top = Object.entries(sp.byModel)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, v]) => `${labelOf(id)} ${usd(v)}`)
    .join(' · ')
  const money = sp.requests ? ` │ Turn ${usd(sp.lastTurn)} │ Σ ${usd(sp.total)}${top ? ` (${top})` : ''}` : ''
  $.ui.status(`⇢ ${head}${money}`)
}

// ── Hooks ──────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'route',
      description: 'Modell-Router: /route [auto|off|opus|sonnet|haiku|fable|reset]',
    })
    const ran = await next(e)
    await paint($)
    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || !e.text.trim()) return next(e)
    const m = await read($, mode)
    if (m === 'off') return next(e)

    let r: Route
    let text = e.text
    if (m === 'auto') {
      const d = decide(e.text, await read($, route))
      r = { tier: d.tier, effort: d.effort, reason: d.reason }
      text = d.stripped || e.text
    } else {
      r = { tier: m, effort: m === 'haiku' ? 'low' : 'high', reason: 'gepinnt' }
    }
    await update($, route, () => r)
    await paint($)
    return next(text === e.text ? e : { ...e, text })
  }).catch(($, e, next) => next(e)) // Routing darf einen Prompt nie blockieren.

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await update($, spend, s => ({ ...s, lastTurn: 0 }))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    let step = e
    // Nur die Hauptschleife umrouten; Subagents behalten ihr eigenes Modell.
    if (!e.agentId && (await read($, mode)) !== 'off') {
      const r = await read($, route)
      if (r) step = { ...e, model: MODELS[r.tier].id, effort: r.effort }
    }

    const res = yield* next(step)

    if (res.usage) {
      const u = res.usage
      const cost = priceOf(u.model, u)
      await update($, spend, s => ({
        total: s.total + cost,
        byModel: { ...s.byModel, [u.model]: (s.byModel[u.model] ?? 0) + cost },
        lastTurn: e.agentId ? s.lastTurn : s.lastTurn + cost,
        requests: s.requests + 1,
      }))
      await paint($)
    }
    return res
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'reset') {
      await update($, spend, () => emptySpend)
      await paint($)
      return { text: 'Kostenzähler zurückgesetzt.' }
    }
    if (arg === 'auto' || arg === 'off' || (TIERS as readonly string[]).includes(arg)) {
      await update($, mode, () => arg as Mode)
      if (arg === 'off') await update($, route, () => null)
      await paint($)
      const msg =
        arg === 'auto'
          ? 'Automatisches Routing an.'
          : arg === 'off'
            ? 'Router aus. Die Session nutzt wieder ihr eingestelltes Modell.'
            : `${MODELS[arg as Tier].label} fest eingestellt. Mit /route auto zurück.`
      return { text: msg }
    }
    if (arg) {
      return { text: `Unbekannt: "${arg}". Erlaubt: auto, off, fable, opus, sonnet, haiku, reset.` }
    }

    const [m, r, sp] = await Promise.all([read($, mode), read($, route), read($, spend)])
    const rows = Object.entries(sp.byModel)
      .sort((a, b) => b[1] - a[1])
      .map(([id, v]) => `  ${id.padEnd(28)} ${usd(v).padStart(9)}  ${sp.total ? Math.round((v / sp.total) * 100) : 0} %`)
    return {
      text: [
        `Modus: ${m}`,
        `Aktuell: ${r ? `${MODELS[r.tier].label}, effort ${r.effort} (${r.reason})` : '–'}`,
        `Requests: ${sp.requests} · letzter Turn ${usd(sp.lastTurn)} · Session ${usd(sp.total)}`,
        ...(rows.length ? ['Kosten nach Modell:', ...rows] : []),
        'Tipp: @opus, @sonnet, @haiku oder @fable im Prompt überstimmt den Router für diesen Prompt.',
      ].join('\n'),
    }
  })
}
