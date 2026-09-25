# Working in this repo

## This repository is PUBLIC

No real names, emails, customers, amounts or company details — in code, tests,
comments, fixtures or commit messages. Sample data uses made-up names.

## The interface is agentic — no tap-and-go

Decided 2026-09-25 for every Eesa application. `public/app.html` is one chat:

- **History down the side** — New chat, "Needs you" (every flow waiting on the
  person, from any conversation), then each conversation, newest first
  (`specialist_chat_conversations`). On a phone it is a drawer.
- **A conversation** is questions to the QuickBooks agent and everything asked
  for in them, in order (`qb_chat`): each answer with **What I did** — the
  agent's own actions from the ledger — and each request as a **flow**: a card
  with its log (asked → drafted → rules → checker → approved → each step →
  done) and the one decision it needs. Changes to QuickBooks are flows too.
- **A new chat** opens by saying where the books stand, in words.
- **One box to type or speak.** Everything goes to the QuickBooks agent, which
  answers from the books and hands setup ("add Alex, $18 an hour", "post this
  week's hours") to the attendance assistant (`qb_request_ask`).

Do not add tabs, menus, settings pages or blank forms. A new capability is an
agent tool in Eesa first (Tool-Flow-Backend), and a card here only when a person
has a decision to make about it. A form belongs only inside a card, to correct
the agent's draft.

## How the page talks to Eesa

The Eesa shell frames `/app` and posts a short-lived session token; every call
goes through `/api/v1/gateway/plugin-ui-invoke/`, which checks the person's
QuickBooks role. Two call paths — `invoke()` for Intuit's tools (they take
`{ params }`) and `platform()` for Eesa's own — deliberately separate. The
comments beside `payload()`, `lastMonth()` and `send()` record real incidents;
read them before changing those.

## Commits

Authored by the user. Never add a Claude/AI co-author trailer or mention.
