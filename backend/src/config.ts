import dotenv from 'dotenv'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '../.env') })
dotenv.config({ path: resolve(process.cwd(), '.env') })

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function loadJsonCredentials() {
  const path = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH
  if (path && existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf-8'))
  }
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (raw) {
    return JSON.parse(raw)
  }
  throw new Error(
    'GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_PATH is required ' +
      'when not using OAuth user credentials (GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN).'
  )
}

// OAuth user delegation (required for personal Gmail accounts — service
// accounts have zero storage quota and Shared Drives don't exist outside
// Google Workspace). If all three OAuth vars are present, uploads run as
// the authorized human user against their own My Drive quota instead.
const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID
const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
const oauthRefreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
const useOAuth = !!(oauthClientId && oauthClientSecret && oauthRefreshToken)

export const config = {
  port: parseInt(process.env.PORT || '4050', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  apiKey: process.env.API_KEY || '',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  google: {
    authMode: useOAuth ? ('oauth' as const) : ('service_account' as const),
    credentials: useOAuth ? undefined : loadJsonCredentials(),
    oauth: useOAuth
      ? { clientId: oauthClientId!, clientSecret: oauthClientSecret!, refreshToken: oauthRefreshToken! }
      : undefined,
    driveFolderId: (() => {
      const id = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || 'root'
      if (id === 'root' && !useOAuth) {
        console.warn(
          'WARNING: GOOGLE_DRIVE_ROOT_FOLDER_ID is unset or "root". Service accounts have ' +
            'no storage quota in their own My Drive — uploads WILL fail with storageQuotaExceeded. ' +
            'Set GOOGLE_DRIVE_ROOT_FOLDER_ID to a folder ID inside a Shared Drive the service ' +
            'account has been added to, or switch to OAuth user credentials ' +
            '(GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN) for personal Gmail accounts.'
        )
      }
      return id
    })(),
  },
  s3: {
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || `http://localhost:${process.env.PORT || '4050'}`,
  },
}
