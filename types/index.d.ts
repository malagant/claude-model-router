export type Tier = 'fable' | 'opus' | 'sonnet' | 'haiku'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** `auto` routes every prompt; a tier pins that model; `off` leaves the session's model alone. */
export type Mode = 'auto' | 'off' | Tier

export type Route = {
  tier: Tier
  effort: Effort
  /** Why: the signals that decided it, or `pinned`, `@hint`, `follow-up`, `default`. */
  reason: string
}

export type Spend = {
  /** US dollars across every priced response this session, subagents included. */
  total: number
  /** US dollars per model ID, as the API reported it. */
  byModel: Record<string, number>
  /** US dollars of the current (or last) main-loop turn. */
  lastTurn: number
  /** API requests counted. */
  requests: number
}

declare module 'claude-code' {
  interface PluginState {
    'model-router': { mode: Mode; route: Route | null; spend: Spend }
  }
}
