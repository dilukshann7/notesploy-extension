# Notesploy browser extension

Save pages, highlights and images to your Notesploy library from Chrome and Edge.

- **Save this page** (toolbar popup, context menu, or Ctrl+Shift+S / Command+Shift+S) saves the page link.
- **Save link** saves the link you right-clicked.
- **Save highlight** saves selected text, with the page as attribution.
- **Save image** uploads a JPEG, PNG, WebP or HEIC image (20 MB limit).
- **Save what I see** saves the visible text of the page, for pages that Notesploy cannot read.

Built with [WXT](https://wxt.dev), React and TypeScript (Manifest V3).

## Setup

```bash
npm install
cp .env.example .env   # Windows: copy .env.example .env
```

`.env` sets the two base URLs. Production values are the defaults:

| Variable | Default | Purpose |
| --- | --- | --- |
| `WXT_API_BASE` | `https://api.notesploy.com` | API origin. Also becomes the extension's only host permission. |
| `WXT_WEB_BASE` | `https://app.notesploy.com` | Web app (connect page, thread links, settings). |

For local development, uncomment the local values in `.env` (API `http://localhost:8787`, web `http://localhost:5173`). Values are read at build time, so rebuild after changing them.

## Develop

```bash
npm run dev
```

WXT starts a dev build. Load the unpacked extension from `.output/chrome-mv3-dev` (Chrome: `chrome://extensions`, Edge: `edge://extensions`, with Developer mode on).

## Test and type-check

```bash
npm test          # vitest: PKCE, API wrapper, capture bodies, text capping, status polling
npm run compile   # tsc --noEmit
```

## Build and package

```bash
npm run build     # unpacked build in .output/chrome-mv3
npm run zip       # store-ready zip in .output/
```

Chrome and Edge both run the `chrome-mv3` build. To test in Edge, load `.output/chrome-mv3` from `edge://extensions`.

## API types

```bash
npm run contracts:types
```

Regenerates `src/lib/api-types.generated.ts` from `../notesploy-api/contracts/openapi.json`. The extension's hand-written request and response types live in `src/lib/types.ts` and do not depend on the generated file.

## Connect to the API (extension ID and redirect URL)

Sign-in uses `browser.identity.launchWebAuthFlow`. Chrome and Edge redirect to `https://<extension-id>.chromiumapp.org/`, so the API must allow that origin and redirect.

1. Load the unpacked extension. Copy its ID from the extensions page.
2. Redirect URL: `https://<id>.chromiumapp.org/`. You can also print it from the extension's background console with `browser.identity.getRedirectURL()`.
3. Add these to the API's configuration:
   - `EXTENSION_ORIGINS`: `chrome-extension://<id>`
   - `EXTENSION_REDIRECT_URIS`: `https://<id>.chromiumapp.org/`
4. Edge has its own extension ID, so repeat steps 1 to 3 for Edge.

**Fixed IDs.** An unpacked extension's ID is derived from its install path, so it changes if the folder moves. A fixed ID needs a `key` field in the manifest, or a store listing (Chrome Web Store / Edge Add-ons), which assigns the ID. Set the key before you publish, or the redirect URLs above will change.

## Project layout

```
entrypoints/
  background.ts        context menus, shortcut, message handler, notifications
  popup/               React popup: connect, usage, save actions, recent saves
src/lib/
  config.ts            API and web base URLs (from WXT_* env)
  pkce.ts              PKCE verifier and S256 challenge (Web Crypto)
  session.ts           session token storage in browser.storage.local
  auth.ts              connect (PKCE + launchWebAuthFlow) and sign out
  api.ts               fetch wrapper: headers, token rotation, 401, error codes
  capture.ts           request bodies, text limits, image sniffing
  actions.ts           save flows (link, highlight, page, image), fallback, tracking
  status.ts            thread polling and pending-capture storage
  page.ts              injected text reader and Shadow DOM toast
  ui.ts                toolbar badge, notifications, limit copy
  messages.ts          popup <-> background messages and state
  types.ts             hand-written API types
tests/                 vitest unit tests
```

## Notes

- The extension requests no page access beyond the active tab. It never reads a page unless you invoke a save action.
- Image bytes are fetched by the background worker. Images served from another site need that site to allow cross-origin reads; otherwise the save fails with a message to save the page instead.
- Pending captures are kept in storage, so status polling resumes if the browser stops the background worker.
