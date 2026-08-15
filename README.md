# ShipStatic for VS Code

Deploy static websites, landing pages, and prototypes instantly — ask your AI assistant or use the command palette. Free, no account needed.

[ShipStatic](https://shipstatic.com) is static hosting without the complexity. No build steps, no framework lock-in — upload your files and get a live URL.

## Chat with Your AI

This extension adds 15 ShipStatic tools via MCP. Just ask:

- **"Deploy my project"** — uploads your build output and returns a live URL
- **"List my deployments"** — shows everything you've deployed
- **"Set up www.example.com"** — connects a custom domain to your site
- **"Check my DNS records"** — verifies your domain configuration

All tools are available in agent mode automatically — no manual MCP configuration needed. Powered by the [@shipstatic/mcp](https://www.npmjs.com/package/@shipstatic/mcp) server, bundled with the extension.

## Commands

| Command | Description |
|---------|-------------|
| **ShipStatic: Deploy** | Pick a folder, get a live URL |
| **ShipStatic: Deploy with Password** | Same, behind a password |
| **ShipStatic: Set Token** | Store your credential securely in your OS keychain |
| **ShipStatic: Account Info** | Check your email, plan, and usage |

A **deploy button** in the status bar provides one-click deployments.

## Getting Started

1. Install the extension
2. Open the chat and ask to deploy your project

That's it. Your site is live instantly.

From the palette or the status bar, **Deploy** offers the folder you deployed last, then any build output it finds (`dist`, `build`, `out`, `public`, `_site`) — so repeat deploys are a single keypress.

### Password Protection

Want a private site? Run **ShipStatic: Deploy with Password** instead — same flow, plus one prompt (6–128 characters). Visitors must unlock before viewing, on the deployment URL and on any custom domains pointing at it. In agent mode, just ask: *"deploy with password hunter2"*.

Plain **Deploy** never asks, so the common path stays a single pick.

### Token (optional)

Without a token, deployments are public and expire in 3 days — the notification includes a claim link, so you can attach a site to an account after the fact. For permanent deployments:

1. Get a free API key at [my.shipstatic.com/api-key](https://my.shipstatic.com/api-key)
2. Run **ShipStatic: Set Token** from the command palette and paste it — the key *is* the token. One credential, two names: the console mints it as an *API key*, and every setting that carries it is called the *token*.

One slot takes either credential the platform issues: a `ship-` API key or a `deploy-` deploy token. The extension never inspects which one you pasted — the server decides.

Your credential is stored in VS Code's SecretStorage (your OS keychain), never in `settings.json`. It reaches the bundled MCP server as `SHIP_TOKEN` on that server's process, and nowhere else — every other variable on it is explicitly cleared, so a credential exported in your shell for CLI use can never authenticate an agent's "anonymous" deploy.

## Upgrading from 0.2.x

Version 1.0 speaks the ShipStatic 2.x platform, and the credential vocabulary changed with it:

- *ShipStatic: Set API Key* is now **ShipStatic: Set Token** — rebind the command if you had a keybinding for it.
- A key you already stored is migrated automatically the first time 1.0 activates. You do not need to enter it again.
- The bundled MCP server's delete tools were renamed `deployments_delete` and `domains_delete` (from `*_remove`). A saved agent workflow naming the old tool needs updating.

## Requirements

- VS Code 1.101 or later

## Links

- [Website](https://shipstatic.com)
- [ShipStatic MCP](https://mcp.shipstatic.com) — the same tools in Claude Code, Cursor, Windsurf, Zed, Antigravity and any other MCP client: drop `https://mcp.shipstatic.com` into it, no install needed

## License

MIT
