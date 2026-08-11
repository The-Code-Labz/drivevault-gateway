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
    'GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_PATH is required'
  )
}

export const config = {
  port: parseInt(process.env.PORT || '4050', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  apiKey: process.env.API_KEY || '',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  google: {
    credentials: loadJsonCredentials(),
    driveFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || 'root',
  },
  s3: {
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || `http://localhost:${process.env.PORT || '4050'}`,
  },
}
