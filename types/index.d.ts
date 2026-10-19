export type Tier = 'fable' | 'opus' | 'sonnet' | 'haiku'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** `auto` routes every prompt; a tier pins that model; `off` leaves the session's model alone. */
export type Mode = 'auto' | 'off' | Tier

export type Route = {
  tier: Tier
  effort: Effort
  /** Why: the signals that decided it, or `pinned`, `@hint`, `follow-up`. */
  reason: string
}

export type Spend = {
  /** US dollars across every priced response this session, subagents included. */
  total: number
  /** Dollars per model id as the API reported it. */
  byModel: Record<string, number>
  /** Dollars of the current (or last) main-loop turn. */
  lastTurn: number
  /** API requests counted. */
  requests: number
}

declare module 'claude-code' {
  interface PluginState {
    'model-router': { mode: Mode; route: Route | null; spend: Spend }
  }
}
