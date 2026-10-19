# model-router

A Claude Code mod that picks the right Claude model and effort level for every prompt, and shows the actual API cost of the session as it happens.

```
⇢ Opus 5.5 · high · refactor, migrate │ Turn $0.08 │ Σ $3.41 (Opus $2.90 · Sonnet $0.51)
```

In the terminal this appears in the status line below the prompt. In the desktop app it appears as a band above the prompt.

## Installation

In a terminal session, at the prompt:

```
/plugin install model-router --marketplace malagant/claude-model-router
```

From the shell:

```
claude plugin install model-router --marketplace malagant/claude-model-router
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins → Add marketplace, enter `malagant/claude-model-router`, then Add plugin.

## Routing

| Model | Typical tasks |
| --- | --- |
| Haiku 5.5 | Classification, extraction, translation, formatting, short questions |
| Sonnet 5.5 | Default: code, scripts, reviews, Helm/Terraform, writing |
| Opus 5.5 | Refactoring, migrations, architecture, root-cause analysis, security, long prompts |
| Fable 5.1 | Deep research, comprehensive end-to-end work, very long prompts |

- Short follow-up prompts such as "ok, continue" keep the previous model, so the prompt cache is not invalidated by a model switch.
- `@opus`, `@sonnet`, `@haiku` or `@fable` anywhere in a prompt overrides the router for that prompt only. The hint is removed before the prompt is sent.
- Subagents keep their own model. Their cost is included in the session total.
- Routing is keyword-based and runs locally, so it adds no latency and no extra API calls. Keywords are matched in English and German. If it picks the wrong model, use an `@` hint.

## Commands

- `/route` shows the current mode, the chosen model and the cost per model
- `/route auto` automatic routing (default)
- `/route opus`, `/route sonnet`, `/route haiku`, `/route fable` pin one model
- `/route off` disable the router and use the session's configured model
- `/route reset` reset the cost counter

## Cost

Costs are computed from the usage data of every API response, using list prices (October 2026). Cache reads and writes are included, and so is the higher Haiku 5.5 tier for prompts over 100k tokens. Web search fees are not included. Prices live in `hooks/register.tsx`; update them there when list prices change.

## Development

```
claude plugin validate .
claude plugin test .
```

## License

No license file is included yet, so all rights are reserved by default.
