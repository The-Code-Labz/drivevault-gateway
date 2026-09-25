import axios from 'axios'
import type { Bucket, ListObjectsResult, OAuthStatus } from './types'

const STORAGE_KEY = 'drivevault_api_key'

const baseURL = import.meta.env.VITE_API_BASE_URL || ''

// The API key is read at request time from localStorage, not baked in at
// build time. This lets the web UI be configured entirely from the browser —
// no VITE_API_KEY build arg, no rebuilding the image just to set a key.
// Falls back to VITE_API_KEY (if a build still sets it) so existing
// deployments keep working unchanged.
export function getApiKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || import.meta.env.VITE_API_KEY || ''
  } catch {
    return import.meta.env.VITE_API_KEY || ''
  }
}

export function setApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // localStorage unavailable (private mode, etc.) — key just won't persist
  }
}

const api = axios.create({ baseURL: baseURL || undefined })

api.interceptors.request.use((cfg) => {
  const key = getApiKey()
  if (key) {
    cfg.headers = cfg.headers || {}
    cfg.headers['x-api-key'] = key
  }
  return cfg
})

export async function listBuckets(): Promise<Bucket[]> {
  const res = await api.get('/api/buckets')
  return res.data.buckets
}

export async function createBucket(name: string): Promise<Bucket> {
  const res = await api.post(`/api/buckets/${encodeURIComponent(name)}`)
  return res.data
}

export async function listObjects(bucket: string, prefix = ''): Promise<ListObjectsResult> {
  const res = await api.get(`/api/buckets/${encodeURIComponent(bucket)}/objects`, {
    params: { prefix },
  })
  return res.data
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  await api.delete(`/api/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(key)}`)
}

export async function uploadObject(bucket: string, key: string, file: File): Promise<void> {
  await api.put(`/s3/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`, file, {
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  })
}

export function getObjectUrl(bucket: string, key: string): string {
  const key_ = getApiKey()
  const qs = new URLSearchParams({ download: 'true' })
  if (key_) qs.set('key', key_)
  return `${baseURL || ''}/s3/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}?${qs.toString()}`
}

export async function getOAuthStatus(): Promise<OAuthStatus> {
  const res = await api.get('/api/oauth/status')
  return res.data
}

// Opens Google's consent screen in a new tab. Not run through the shared
// axios instance since it's a browser navigation, not an XHR — the API key
// (if set) is required as a query param because oauthRouter's /connect check
// is a plain browser redirect and can't read custom headers.
export function getOAuthConnectUrl(): string {
  const key = getApiKey()
  const qs = key ? `?key=${encodeURIComponent(key)}` : ''
  return `${baseURL || ''}/api/oauth/connect${qs}`
}
