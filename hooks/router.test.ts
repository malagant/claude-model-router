import { expect, test } from 'claude-code/testing'

import { decide, priceOf } from './register'

test('routet nach Aufgabe', () => {
  expect(decide('Refactor die Crossplane-Compositions und migriere die Provider', null).tier).toBe('opus')
  expect(decide('Klassifiziere diese Tickets als JSON', null).tier).toBe('haiku')
  expect(decide('Schreib ein Bash-Script, das die Pods neu startet', null).tier).toBe('sonnet')
  expect(decide('Deep Research: umfassend IDP-Anbieter vergleichen', null).tier).toBe('fable')
  expect(decide('@opus was ist 2+2', null)).toMatchObject({ tier: 'opus', stripped: 'was ist 2+2' })
  const prev = decide('Refactor die Codebase', null)
  expect(decide('ja, mach weiter', prev).tier).toBe('opus')
})

test('rechnet Listenpreise', () => {
  const u = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  expect(Math.round(priceOf('claude-opus-5-5', u) * 1e6) / 1e6).toBe(24)
  expect(Math.round(priceOf('claude-sonnet-5-5', u) * 1e6) / 1e6).toBe(12)
  expect(Math.round(priceOf('claude-haiku-5-5', { ...u, input_tokens: 50_000, output_tokens: 0 }) * 1e6) / 1e6).toBe(0.005)
  expect(Math.round(priceOf('claude-haiku-5-5', { ...u, input_tokens: 200_000, output_tokens: 0 }) * 1e6) / 1e6).toBe(0.1)
})

test('setzt Modell im Turn und zählt Kosten', async ($, on) => {
  const seen: { model: string; effort?: unknown }[] = []
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($, e) {
    seen.push({ model: e.model, effort: e.effort })
    return {
      turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn',
      usage: { model: e.model, input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }
  })

  await $.prompt.submit({ text: 'Refactor die Codebase und migriere die Operator', wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'x', turnId: 't1' })
  const s = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1 })
  for await (const _ of s) void _
  expect(seen[0].model).toBe('claude-opus-5-5')
  expect(seen[0].effort).toBe('high')
  const r = await $.command.run({ command: 'route', args: '' } as never)
  const text = (r as { text?: string }).text ?? ''
  expect(text).toContain('Opus 5.5')
  expect(text).toContain('$0.08')
})
