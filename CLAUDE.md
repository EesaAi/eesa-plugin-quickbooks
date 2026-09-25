# Working in this repo

## This repository is PUBLIC

No real names, emails, customers, amounts or company details — in code, tests,
comments, fixtures or commit messages. Sample data uses made-up names.

## The interface is agentic — no tap-and-go

Decided 2026-09-25 for every Eesa application. `public/app.html` is one screen:

- **The page speaks first** — a greeting and where the books stand, in words,
  with the few numbers the person's QuickBooks role lets them see.
- **What needs you** — cards the agents and tasks made, each with one decision:
  a change to approve (the amount is the largest thing on it; high-risk amounts
  are typed back), an attendance request drafted by the assistant and checked by
  a checker, hours ready to post, people not matched yet.
- **What you asked, and the answer** — one box to type or speak. Everything goes
  to the QuickBooks agent, which answers from the books and hands setup ("add
  Alex, $18 an hour") to the attendance assistant (`qb_request_ask`). What an
  answer made shows as a live card right under it.
- **What was done** — quietly, below.

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
