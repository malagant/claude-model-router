import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Effort, Mode, Route, Spend, Tier } from '../types'

// ── Models ─────────────────────────────────────────────────────────────────────

export const MODELS: Record<Tier, { id: string; label: string }> = {
  fable: { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  opus: { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  sonnet: { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  haiku: { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
}

const TIERS: readonly Tier[] = ['fable', 'opus', 'sonnet', 'haiku']

// ── List prices in USD per million tokens, as of October 2026 ─────────────
// Order matters: the first pattern that matches the model ID wins.

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
  // Haiku 5.5: prompts over 100k tokens are billed at the higher tier.
  [/haiku-5-5/, { in: 0.1, hit: 0.01, out: 0.5 }, { in: 0.5, hit: 0.05, out: 2.5 }],
  [/haiku/, { in: 1, hit: 0.1, out: 5 }],
]

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** Dollar cost of one response; 5-minute cache writes billed at 1.25× input. Unknown model: 0. */
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

// Keyword signals in English and German, matched case-insensitively against the prompt.
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

/** Picks model and effort for a prompt; `previous` carries short follow-up prompts over. */
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
    return { ...previous, reason: 'follow-up', stripped: text }
  }

  // On a tie: Sonnet before Opus before Haiku before Fable.
  const tier = (['sonnet', 'opus', 'haiku', 'fable'] as const).reduce((a, b) =>
    score[b] > score[a] ? b : a,
  )
  const reason = hits[tier].slice(0, 3).join(', ') || 'default'
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

// ── State ──────────────────────────────────────────────────────────────────────

const mode = atom({ plugin: 'model-router', key: 'mode' } as const, 'auto' as Mode)
const route = atom({ plugin: 'model-router', key: 'route' } as const, null as Route | null)
const emptySpend: Spend = { total: 0, byModel: {}, lastTurn: 0, requests: 0 }
const spend = atom({ plugin: 'model-router', key: 'spend' } as const, emptySpend)

const usd = (v: number) => (v < 0.01 && v > 0 ? '<$0.01' : '$' + v.toFixed(2))

function labelOf(modelId: string): string {
  const tier = TIERS.find(t => modelId.includes(t))
  return tier ? MODELS[tier].label.split(' ')[0] : modelId
}

function summary(m: Mode, r: Route | null, sp: Spend): string {
  const head =
    m === 'off'
      ? 'Router off'
      : r
        ? `${MODELS[r.tier].label} · ${r.effort}${m !== 'auto' ? ' (fixed)' : ''} · ${r.reason}`
        : 'Router ready'
  const top = Object.entries(sp.byModel)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, v]) => `${labelOf(id)} ${usd(v)}`)
    .join(' · ')
  const money = sp.requests ? ` │ Turn ${usd(sp.lastTurn)} │ Σ ${usd(sp.total)}${top ? ` (${top})` : ''}` : ''
  return `⇢ ${head}${money}`
}

// Terminal: status line below the prompt. Desktop and other surfaces: band above the prompt (see ui.render).
async function paint($: EngineInterface) {
  const [m, r, sp] = await Promise.all([read($, mode), read($, route), read($, spend)])
  $.ui.status(summary(m, r, sp))
}

// ── Hooks ──────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'route',
      description: 'Model router: /route [auto|off|opus|sonnet|haiku|fable|reset]',
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
      r = { tier: m, effort: m === 'haiku' ? 'low' : 'high', reason: 'pinned' }
    }
    await update($, route, () => r)
    await paint($)
    return next(text === e.text ? e : { ...e, text })
  }).catch(($, e, next) => next(e)) // Routing must never block a prompt.

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await update($, spend, s => ({ ...s, lastTurn: 0 }))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    let step = e
    // Only re-route the main loop; subagents keep their own model.
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'terminal') return next(e) // the status line shows the same there
    const [m, r, sp] = await Promise.all([read($, mode), read($, route), read($, spend)])
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>{summary(m, r, sp)}</Text>
      </Box>
    )
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'reset') {
      await update($, spend, () => emptySpend)
      await paint($)
      return { text: 'Cost counter reset.' }
    }
    if (arg === 'auto' || arg === 'off' || (TIERS as readonly string[]).includes(arg)) {
      await update($, mode, () => arg as Mode)
      if (arg === 'off') await update($, route, () => null)
      await paint($)
      const msg =
        arg === 'auto'
          ? 'Automatic routing on.'
          : arg === 'off'
            ? 'Router off. The session uses its configured model again.'
            : `${MODELS[arg as Tier].label} pinned. Use /route auto to switch back.`
      return { text: msg }
    }
    if (arg) {
      return { text: `Unknown option "${arg}". Allowed: auto, off, fable, opus, sonnet, haiku, reset.` }
    }

    const [m, r, sp] = await Promise.all([read($, mode), read($, route), read($, spend)])
    const rows = Object.entries(sp.byModel)
      .sort((a, b) => b[1] - a[1])
      .map(([id, v]) => `  ${id.padEnd(28)} ${usd(v).padStart(9)}  ${sp.total ? Math.round((v / sp.total) * 100) : 0} %`)
    return {
      text: [
        `Mode: ${m}`,
        `Current: ${r ? `${MODELS[r.tier].label}, effort ${r.effort} (${r.reason})` : '–'}`,
        `Requests: ${sp.requests} · last turn ${usd(sp.lastTurn)} · session ${usd(sp.total)}`,
        ...(rows.length ? ['Cost by model:', ...rows] : []),
        'Tip: @opus, @sonnet, @haiku or @fable in a prompt overrides the router for that prompt.',
      ].join('\n'),
    }
  })
}
