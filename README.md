# alleyweb

Minimal desktop browser for **truedev** (roryb). Alleyweb only opens a narrow set of destinations — everything else is blocked.

## Allowed destinations

| Category | Examples |
|----------|----------|
| **BT Home Hub** | `http://192.168.1.254`, `http://bthomehub.home`, `http://hub.home` |
| **Localhost** | `http://localhost:3000`, `http://127.0.0.1:8080` |
| **Direct IP** | `http://10.0.0.5`, `https://192.168.0.1/admin` |
| **Cursor** | `https://cursor.com`, `https://docs.cursor.com` |
| **Local HTML** | `file:///path/to/page.html`, or paste a Windows path like `C:\Games\Alley Game\index.html` (only `.html` / `.htm` files) |

Other domain names are rejected. Non-http(s) schemes are rejected except allowed `file://` HTML pages. Known OAuth authorization endpoints that require a system browser open externally.

## Requirements

- Node.js 20+
- npm

## Run locally

```bash
npm install
npm start
```

On first launch, alleyweb opens the BT Home Hub default address (`192.168.1.254`). Type an allowed address in the bar and press **Go**. Use **Ctrl+T** for a tab, **Ctrl+W** to close it, **Ctrl+Tab** / **Ctrl+Shift+Tab** to switch, and **Ctrl+L** to focus the address bar. Tabs restore on restart, and website cookies remain in Electron's persistent default session.

OAuth popup windows stay inside Alleyweb and share the same session. Google, Microsoft, and Apple authorization URLs that are blocked from embedded use open in the system browser; the app's allowlist continues to validate in-app navigation and redirects.

## Development

```bash
npm run dev
```

Policy logic lives in `src/allowed-urls.ts`. Navigation guards are applied in the main process (`will-navigate`, `will-redirect`, `setWindowOpenHandler`, and session `webRequest` for main-frame loads).

## Project layout

```
src/
  main.ts           Electron main process + BrowserView
  preload.ts        IPC bridge for the chrome UI
  allowed-urls.ts   URL allowlist policy
  renderer/         Minimal address bar + controls
```

## License

MIT