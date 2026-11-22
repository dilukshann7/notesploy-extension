import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

/**
 * WXT loads .env files only after this config is evaluated, so the API origin needed for
 * host_permissions is read here. Same files and precedence as WXT: process.env wins.
 */
function readDotEnv(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of ['.env', '.env.local']) {
    const path = resolve(process.cwd(), name);
    if (!existsSync(path)) continue;
    Object.assign(values, parseEnv(readFileSync(path, 'utf-8')));
  }
  return values;
}

const dotEnv = readDotEnv();
const apiBase = (process.env.WXT_API_BASE || dotEnv.WXT_API_BASE || 'https://api.notesploy.com').trim();

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Notesploy',
    description: 'Save pages, highlights and images to your Notesploy library.',
    // Only the API origin is requested. Pages are read through activeTab on user action.
    permissions: ['activeTab', 'contextMenus', 'storage', 'scripting', 'notifications', 'identity'],
    host_permissions: [`${new URL(apiBase).origin}/*`],
    action: {
      default_title: 'Notesploy',
    },
    commands: {
      'save-page': {
        suggested_key: {
          default: 'Ctrl+Shift+S',
          mac: 'Command+Shift+S',
        },
        description: 'Save this page to Notesploy',
      },
    },
  },
});
