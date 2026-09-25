# Working in this repo

## This repository is PUBLIC

No real names, emails, customers, amounts or company details — in code, tests,
comments, fixtures or commit messages. Sample data uses made-up names.

## The interface is agentic — no tap-and-go

Decided 2026-09-25 for every Eesa application. `public/app.html` is **Eesa's
own chat, for the QuickBooks agent only** — same layout, colours (Eesa's
tokens), bubbles, "Used N steps" trail and floating ask box as Eesa's chat:

- **Chats down the side** (`specialist_chat_conversations`), newest first; a
  drawer on a phone. "Waiting on you" sits at the top only when something
  waits on the person (changes to approve, drafts, hours to post).
- **A conversation** (`qb_chat`): questions, answers with the steps the agent
  took, and every request made in it as a card with its log and the one
  decision it needs.
- **An empty chat** is Eesa's: a greeting and a few ways to start that fill the
  box. No brief, no summary text — the user asked for none.
- **One box to type or speak.** Everything goes to the QuickBooks agent, which
  hands setup ("add Alex, $18 an hour") to the attendance assistant.

Do not add tabs, menus, settings pages, blank forms or explanatory text. A new
capability is an agent tool in Eesa first (Tool-Flow-Backend), and a card here
only when a person has a decision to make about it.

## How the page talks to Eesa

The Eesa shell frames `/app` and posts a short-lived session token; every call
goes through `/api/v1/gateway/plugin-ui-invoke/`, which checks the person's
QuickBooks role. Two call paths — `invoke()` for Intuit's tools (they take
`{ params }`) and `platform()` for Eesa's own — deliberately separate. The
comments beside `payload()`, `lastMonth()` and `send()` record real incidents;
read them before changing those.

## Commits

Authored by the user. Never add a Claude/AI co-author trailer or mention.
