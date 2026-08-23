import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'

// Persists OAuth user credentials obtained via the /api/oauth/connect web
// flow to disk (under the same ./data volume already used for the service
// account key), so a refresh token minted through the browser survives
// container restarts without ever touching .env.
const STORE_PATH = resolve(process.env.OAUTH_TOKEN_STORE_PATH || './data/oauth-tokens.json')

export interface StoredOAuthConfig {
  clientId: string
  clientSecret: string
  refreshToken: string
  updatedAt: string
}

export function readStoredOAuthConfig(): StoredOAuthConfig | undefined {
  try {
    if (!existsSync(STORE_PATH)) return undefined
    return JSON.parse(readFileSync(STORE_PATH, 'utf-8'))
  } catch (err) {
    console.error(`Failed to read OAuth token store at ${STORE_PATH}:`, err)
    return undefined
  }
}

export function writeStoredOAuthConfig(cfg: Omit<StoredOAuthConfig, 'updatedAt'>): void {
  const dir = dirname(STORE_PATH)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  const data: StoredOAuthConfig = { ...cfg, updatedAt: new Date().toISOString() }
  writeFileSync(STORE_PATH, JSON.stringify(data, null, 2))
}

export const oauthStorePath = STORE_PATH
