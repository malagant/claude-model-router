# model-router

Ein Claude-Code-Mod, der pro Prompt automatisch das passende Claude-Modell samt Effort wählt und die tatsächlich angefallenen API-Kosten in der Statuszeile anzeigt.

```
⇢ Opus 5.5 · high · refactor, migrier │ Turn $0.08 │ Σ $3.41 (Opus $2.90 · Sonnet $0.51)
```

## Installation

Im Prompt einer Terminal-Session:

```
/plugin install model-router --marketplace malagant/claude-model-router
```

Aus der Shell:

```
claude plugin install model-router --marketplace malagant/claude-model-router
```

In der Desktop-App, wo `/plugin` nicht läuft: Plus neben dem Prompt, dann Plugins, Add marketplace mit `malagant/claude-model-router`, dann Add plugin.

## Routing

| Modell | Typische Aufgaben |
| --- | --- |
| Haiku 5.5 | Klassifizieren, Extrahieren, Übersetzen, Formatieren, kurze Fragen |
| Sonnet 5.5 | Standard: Code, Scripts, Reviews, Helm/Terraform, Mails |
| Opus 5.5 | Refactoring, Migration, Architektur, Root Cause, Security, lange Prompts |
| Fable 5.1 | Deep Research, umfassende End-to-End-Aufgaben, sehr lange Prompts |

Kurze Folge-Prompts („ja, mach weiter“) behalten das vorige Modell, damit der Prompt-Cache nicht verfällt. `@opus`, `@sonnet`, `@haiku` oder `@fable` im Prompt überstimmt den Router für diesen einen Prompt. Subagents behalten ihr eigenes Modell.

## Befehle

- `/route` zeigt Modus, aktuelle Wahl und Kosten pro Modell
- `/route auto` automatisches Routing
- `/route opus|sonnet|haiku|fable` ein Modell fest einstellen
- `/route off` Router aus
- `/route reset` Kostenzähler zurücksetzen

## Kosten

Die Kosten werden aus den Usage-Daten jeder API-Antwort mit Listenpreisen berechnet (Oktober 2026), inklusive Cache-Reads und -Writes und dem höheren Haiku-5.5-Satz über 100k Prompt-Tokens. Gebühren für Websuche sind nicht enthalten. Die Preise stehen in `hooks/register.ts` und müssen bei Preisänderungen dort nachgezogen werden.

## Entwicklung

```
claude plugin validate .
claude plugin test .
```
