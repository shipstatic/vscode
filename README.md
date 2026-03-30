# ShipStatic for VS Code

Deploy and manage static sites from VS Code — with MCP tools for GitHub Copilot.

[ShipStatic](https://shipstatic.com) is a simpler alternative to Vercel and Netlify, specialized for static website hosting. No build steps, no framework lock-in — just upload your files and get a URL.

## Features

### MCP Tools for Copilot

This extension registers the [ShipStatic MCP server](https://www.npmjs.com/package/@shipstatic/mcp) as a VS Code MCP provider. All 15 tools are automatically available in GitHub Copilot's agent mode — no manual configuration needed.

Ask Copilot to deploy your site, manage domains, check DNS records, and more — all from the chat.

### Commands

| Command | Description |
|---------|-------------|
| `ShipStatic: Deploy` | Deploy a directory to ShipStatic |
| `ShipStatic: Set API Key` | Store your API key securely |
| `ShipStatic: Account Info` | Show your account details |

### Status Bar

A deploy button in the status bar for quick one-click deployments.

## Setup

1. Install the extension
2. Run `ShipStatic: Set API Key` from the command palette and enter your API key
3. Start using Copilot or the deploy command

Get your API key at [my.shipstatic.com](https://my.shipstatic.com).

## MCP Tools

### Deployments

| Tool | Description |
|------|-------------|
| `deployments_upload` | Deploy a static site by uploading files from a directory |
| `deployments_list` | List all deployments with their URLs, status, and labels |
| `deployments_get` | Get deployment details including URL, status, file count, size, and labels |
| `deployments_set` | Update deployment labels |
| `deployments_remove` | Permanently delete a deployment and its files |

### Domains

| Tool | Description |
|------|-------------|
| `domains_set` | Create or update a custom domain |
| `domains_list` | List all domains with their linked deployments and verification status |
| `domains_get` | Get domain details including linked deployment, verification status, and labels |
| `domains_records` | Get the DNS records the user needs to configure at their DNS provider |
| `domains_dns` | Look up the DNS provider for a domain |
| `domains_share` | Get a shareable DNS setup hash for a domain |
| `domains_validate` | Check if a domain name is valid and available |
| `domains_verify` | Trigger DNS verification for a custom domain |
| `domains_remove` | Permanently delete a domain |

### Account

| Tool | Description |
|------|-------------|
| `whoami` | Show authenticated account details including email, plan, and usage |

## Requirements

- VS Code 1.99 or later
- A ShipStatic account ([shipstatic.com](https://shipstatic.com))

## License

MIT
