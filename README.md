# ShipStatic for VS Code

Deploy static sites instantly — ask your AI assistant or use the command palette. Free, no account needed.

[ShipStatic](https://shipstatic.com) is static hosting without the complexity. No build steps, no framework lock-in — upload your files and get a live URL.

## Chat with Your AI

This extension adds 15 ShipStatic tools via MCP. Just ask:

- **"Deploy my project"** — uploads your build output and returns a live URL
- **"List my deployments"** — shows everything you've deployed
- **"Set up www.example.com"** — connects a custom domain to your site
- **"Check my DNS records"** — verifies your domain configuration

All tools are available in agent mode automatically — no manual MCP configuration needed. Powered by the [@shipstatic/mcp](https://www.npmjs.com/package/@shipstatic/mcp) server.

## Commands

| Command | Description |
|---------|-------------|
| **ShipStatic: Deploy** | Pick a folder, get a live URL |
| **ShipStatic: Set API Key** | Store your key securely in your OS keychain |
| **ShipStatic: Account Info** | Check your email, plan, and usage |

A **deploy button** in the status bar provides one-click deployments.

## Getting Started

1. Install the extension
2. Open the chat and ask to deploy your project

That's it. Your site is live immediately.

### API Key (optional)

Without an API key, deployments are public and expire in 3 days. For permanent deployments:

1. Get a free key at [my.shipstatic.com/api-key](https://my.shipstatic.com/api-key)
2. Run **ShipStatic: Set API Key** from the command palette

## Requirements

- VS Code 1.99 or later

## Links

- [Website](https://shipstatic.com)
- [MCP Server](https://www.npmjs.com/package/@shipstatic/mcp) — use ShipStatic tools in Claude Code, Cursor, Windsurf, Zed, Antigravity, and other MCP clients

## License

MIT
