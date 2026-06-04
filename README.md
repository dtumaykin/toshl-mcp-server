# Toshl MCP Server

An MCP (Model Context Protocol) server for integrating [Toshl Finance](https://toshl.com/) with AI agents.

## Overview

The Toshl MCP Server provides a bridge between AI agents and the Toshl Finance API. It allows AI agents to access financial data from Toshl, analyze it, and provide insights and advice based on the data.

## Features

- READ access to Toshl Finance API endpoints:

  - Accounts
  - Categories
  - Tags
  - Budgets
  - User information
  - Planning

- MCP Resources:

  - List accounts
  - Get account details
  - List categories
  - Get category details
  - List tags
  - Get tag details
  - List budgets
  - Get budget details
  - Get budget history
  - Get user profile
  - Get account summary
  - List entries

- MCP Tools:
  - Account tools (list accounts, get account details)
  - Category tools (list categories, get category details)
  - Tag tools (list tags, get tag details)
  - Budget tools (list budgets, get budget details, get budget history)
  - User tools (get profile, get summary, get payment types, get payments)
  - Entry tools (list entries, get entry details, get entry sums, get entry timeline, create entry, update entry, delete entry, manage entries)
  - Analysis tools (analyze spending by category, analyze budget performance, analyze account balances)

## Prerequisites

- Node.js (v18.x or higher)
- npm (v8.x or higher)
- Toshl Finance API token

## Get API Token

1. go to https://developer.toshl.com/apps/
2. create new personal token. Insert name for token under "Description" and your account password under "Password"

## Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/toshl-mcp-server.git
cd toshl-mcp-server
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file based on the `.env.example` file:

```bash
cp .env.example .env
```

4. Edit the `.env` file and add your Toshl API token:

```
TOSHL_API_TOKEN=your_api_token
```

## Building

Build the project:

```bash
npm run build
```

## Running

Start the server:

```bash
npm start
```

## Configure MCP server

```
 "toshl-mcp-server": {
      "command": "node",
      "args": [
        "/root/source/personal/toshl-mcp-server/dist/index.js"
      ],
      "env": {
        "TOSHL_API_TOKEN": "your-token",
        "TOSHL_API_BASE_URL": "https://api.toshl.com",
        "MCP_SERVER_NAME": "toshl-mcp-server",
        "MCP_SERVER_VERSION": "0.1.0",
        "CACHE_TTL": "3600",
        "CACHE_ENABLED": "true",
        "LOG_LEVEL": "debug"
      },
      "disabled": false,
      "autoApprove": []
    }
```

## Development

Run the server in development mode:

```bash
npm run dev
```

## Documentation

- [API Overview](docs/api/overview.md)
- [Authentication](docs/api/auth.md)
- [Accounts](docs/api/accounts.md)
- [Entries](docs/api/entries.md)
- [Transfers](docs/api/transfers.md)

## Project Structure

```
toshl-mcp-server/
├── src/
│   ├── index.ts                 # Entry point
│   ├── server/                  # MCP server implementation
│   │   └── server.ts            # Main server class
│   ├── api/                     # Toshl API client
│   │   ├── toshl-client.ts      # Base API client
│   │   ├── auth.ts              # Authentication module
│   │   └── endpoints/           # Endpoint-specific clients
│   │       ├── accounts.ts      # Accounts API client
│   │       ├── categories.ts    # Categories API client
│   │       ├── tags.ts          # Tags API client
│   │       ├── budgets.ts       # Budgets API client
│   │       ├── entries.ts       # Entries API client
│   │       ├── me.ts            # User API client
│   │       └── planning.ts      # Planning API client
│   ├── resources/               # MCP resource handlers
│   │   ├── account-resources.ts # Account resources
│   │   ├── category-resources.ts# Category resources
│   │   ├── tag-resources.ts     # Tag resources
│   │   ├── budget-resources.ts  # Budget resources
│   │   └── user-resources.ts    # User resources
│   ├── tools/                   # MCP tool handlers
│   │   ├── account-tools.ts     # Account tools
│   │   ├── category-tools.ts    # Category tools
│   │   ├── tag-tools.ts         # Tag tools
│   │   ├── budget-tools.ts      # Budget tools
│   │   ├── user-tools.ts        # User tools
│   │   └── analysis-tools.ts    # Financial analysis tools
│   └── utils/                   # Utility functions
│       ├── cache.ts             # Caching utilities
│       ├── error-handler.ts     # Error handling utilities
│       ├── logger.ts            # Logging utilities
│       └── types.ts             # TypeScript type definitions
├── dist/                        # Compiled JavaScript files
├── .env                         # Environment variables
├── .env.example                 # Example environment variables
├── package.json                 # Project dependencies
├── tsconfig.json                # TypeScript configuration
└── README.md                    # Project documentation
```

## Configuration

The server can be configured using environment variables:

- `TOSHL_API_TOKEN`: Your Toshl API token
- `TOSHL_API_BASE_URL`: The base URL for the Toshl API (default: https://api.toshl.com)
- `MCP_SERVER_NAME`: The name of the MCP server (default: toshl-mcp-server)
- `MCP_SERVER_VERSION`: The version of the MCP server (default: 0.1.0)
- `CACHE_TTL`: Time to live for cached data in seconds (default: 3600)
- `CACHE_ENABLED`: Whether caching is enabled (default: true)
- `LOG_LEVEL`: Logging level (default: info)

## Safety controls

This fork adds two safety mechanisms for anyone running the server against a real Toshl account — in particular when a scheduled agent (e.g. Cowork) is calling the tools unattended.

### Environment variables

- `TOSHL_ALLOW_DELETE` (default: `false`). Must be exactly the string `true` to enable any operation that deletes a Toshl entry.
  - When `false`, the `entry_delete` tool is **not registered** — it does not appear in the tool list returned to the MCP client.
  - When `false`, `entry_convert_to_transfer` is also not listed, because the conversion deletes the original entry.
  - If a caller invokes either tool anyway, the call is refused with an error and a `delete_blocked` / `convert_blocked` record is appended to the audit log.
- `TOSHL_AUDIT_LOG` (default: `~/.toshl-mcp/audit.log`, with `~` expanded to the home directory). File path for the audit log. The parent directory is created at startup if it does not exist.
- `TOSHL_TRANSFER_CATEGORY_ID` (optional). Override for the auto-detected Transfer category. By default the server picks the category where `type === 'expense'` and `name` matches `Transfer` (case-insensitive) — that's the source-side leg of a Toshl transfer. Set this if your account uses a localized category name (e.g. "Virement", "Überweisung") or if auto-detection picks the wrong category. Find the ID via `category_list` and restart the server after setting.

### Batch preview / commit flow

Write operations (`create`, `update`, `manage`, `split`) are not exposed as individual tools. Instead, they go through a two-step flow:

1. `entry_batch_preview` — accepts an `operations` array of `{ action, data }` items, validates every operation, generates a UUID confirmation token (5-minute expiry), appends a `preview` record to the audit log, and returns the token plus the normalised operations and a count summary (e.g. `"3 creates, 1 update"`). No Toshl API call is made.
2. `entry_batch_commit` — accepts the `confirmation_token` returned by preview, marks the token used (preventing replay), executes each operation in order, and returns a per-operation result list. A single failed operation does not abort the rest; the response is honest about partial success.

Single-entry edits are expressed as a batch of one — the flow is the same for interactive use and scheduled use.

#### Split action

The `split` action turns one expense entry into "what stayed on me" plus "what a friend owes me". Use it when you paid for a shared expense and want the friend's share recorded as money owed.

What it does, given an original expense (e.g. `-100 EUR` from your checking account):

1. **Creates a new transfer entry** from the same source account to a `friend_account` you supply, for the friend's share (e.g. `-50 EUR`). The transfer uses the Toshl "transfer"-type category and inherits the original entry's currency, date, and tags. Its description defaults to the original's `desc` but can be overridden with `transfer_desc`.
2. **Reduces the original entry's amount** to the user's retained portion (e.g. `-50 EUR`). The original's description, account, category, date, and tags are unchanged.

Inputs (the `data` block of a `split` operation):

- `id` (required) — the original expense entry's ID.
- `friend_account` (required) — destination account ID for the transfer (i.e. the friend's tracking account).
- Exactly one of:
  - `share_amount` — the friend's portion as a positive absolute number, in the original entry's currency.
  - `equal: true` — 50/50 split.
- `transfer_desc` (optional) — description for the transfer entry. Defaults to the original entry's `desc`.

Constraints, enforced at commit time:

- The original must be an expense (negative `amount`) and must not already be a transfer.
- The share must be `> 0` and strictly less than the original's absolute amount (so a non-zero portion stays as your expense). Amounts are rounded to 2 decimals.

Worked example — 100 EUR dinner, 50/50:

```jsonc
// entry_batch_preview
{
  "operations": [
    { "action": "split",
      "data": {
        "id": "<dinner-entry-id>",
        "friend_account": "<friend-tracking-account-id>",
        "equal": true
      } }
  ]
}
// → returns { confirmation_token, summary: "1 split", ... }

// entry_batch_commit
{ "confirmation_token": "<token>" }
// → result includes { original_id, retained_amount: -50, transfer_id, transfer_amount: -50 }
```

Ordering and recovery: the transfer entry is created first; only then is the original reduced. If the create succeeds but the subsequent update fails, the response returns both the new `transfer_id` and the target `retained_amount` so you can manually reconcile. The split's pre-state and the new transfer's ID are written to the audit log between the two API calls, so the recovery handle is durable on disk.

### Audit log

Every preview, commit, and blocked-delete / blocked-convert call appends one JSON line (JSON Lines) to the audit log. Fields:

- `timestamp` — ISO 8601
- `event` — `preview` | `commit` | `delete_blocked` | `convert_blocked`
- `token` — the confirmation token (nullable)
- `payload` — the operation details or error context

Writes are synchronous `appendFileSync` calls so the record hits disk before (or very shortly after) the corresponding Toshl API call fires.

## License

MIT
