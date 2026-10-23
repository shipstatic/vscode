# ShipStatic for VS Code

Deploy static websites, landing pages, and prototypes instantly from chat or the command palette. Free, no account needed.

## Try it in seconds, no account needed

1. Install the extension: search **ShipStatic** in the Extensions view, or open Quick Open (`Cmd+P` / `Ctrl+P`) and run `ext install shipstatic.shipstatic`.
2. Ask your AI in agent mode: *"Publish this with ShipStatic."* Or run **ShipStatic: Deploy** from the command palette, or click the deploy button in the status bar, and pick the folder.

You get back a link you can share right away, and a claim link. The site stays up for 3 days, and opening the claim link keeps it for good.

Want it private? Run **ShipStatic: Deploy with Password**, or ask for *"ShipStatic's built-in password protection"*. Visitors have to type the password (6–128 characters) before they see anything, on the site's link and on any custom domain pointing at it. Plain **Deploy** never asks, so the usual path stays a single pick.

**Deploy** offers the folder you published last, then any build output it finds (`dist`, `build`, `out`, `public`, `_site`), so publishing again is a single keypress.

## Keep your sites with a free account

Everything above works with no account. A free account keeps your sites for good, lets you use your own domain, and shows you everything you've published in one place.

1. Get your free API key at [my.shipstatic.com/api-key](https://my.shipstatic.com/api-key).
2. Run **ShipStatic: Set Token** from the command palette and paste it. One credential, two names: the console calls it an *API key*, and every setting that carries it is called the *token*.

One slot takes either credential the platform issues: a `ship-` API key or a `deploy-` deploy token. The extension never inspects which one you pasted; the server decides.

Your credential is stored in VS Code's SecretStorage (your OS keychain), never in `settings.json`. It reaches the bundled MCP server as `SHIP_TOKEN` on that server's process, and nowhere else. Every other variable there is cleared, so a credential exported in your shell for the CLI can never turn an agent's no-account publish into an account one.

### What you can ask

The extension adds 15 ShipStatic tools to agent mode, with no MCP setup. They come from the [@shipstatic/mcp](https://www.npmjs.com/package/@shipstatic/mcp) server, bundled with the extension. Publishing works with no account; the rest answer once your token is set:

- **"Publish this with ShipStatic"**: publishes your build output and gives you the link
- **"List my ShipStatic sites"**: shows everything you've published
- **"Set up www.example.com"**: connects your own domain to your site
- **"Check my DNS records"**: checks your domain's setup

### Commands

| Command | Description |
|---------|-------------|
| **ShipStatic: Deploy** | Pick a folder, get a live link |
| **ShipStatic: Deploy with Password** | The same, behind a password |
| **ShipStatic: Set Token** | Store your credential securely in your OS keychain |
| **ShipStatic: Account Info** | Check your email, plan, and usage |

## Upgrading from 0.2.x

Version 1.0 renamed one command and two tools, and moved your stored key over for you:

- *ShipStatic: Set API Key* is now **ShipStatic: Set Token**. Rebind the command if you had a keybinding for it.
- A key you already stored is migrated automatically the first time 1.0 activates. You do not need to enter it again.
- The bundled MCP server's delete tools were renamed `deployments_delete` and `domains_delete` (from `*_remove`). A saved agent workflow naming the old tool needs updating.

## Requirements

- VS Code 1.101 or later

## Also available

| Surface | Reach it |
|---------|----------|
| **[MCP](https://mcp.shipstatic.com)** | Drop `https://mcp.shipstatic.com` into any MCP client |
| **[CLI and SDK](https://github.com/shipstatic/ship)** | `npx @shipstatic/ship ./dist` |
| **[Plugin](https://github.com/shipstatic/plugin)** | Install it in Cursor, Claude Code, Codex or Gemini CLI |
| **[n8n](https://www.npmjs.com/package/n8n-nodes-shipstatic)** | Search "ShipStatic" in n8n's node panel |
| **[GitHub Action](https://github.com/shipstatic/action)** | `shipstatic/action@v3` |
| **[Agent Skill](https://www.shipstatic.com/SKILL.md)** | `npx skills add shipstatic/plugin` |

## License

MIT
