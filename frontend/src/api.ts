import axios from 'axios'
import type { Bucket, ListObjectsResult } from './types'

const apiKey = import.meta.env.VITE_API_KEY || ''
const baseURL = import.meta.env.VITE_API_BASE_URL || ''

const api = axios.create({
  baseURL: baseURL || undefined,
  headers: apiKey ? { 'x-api-key': apiKey } : {},
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
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
  })
}

export function getObjectUrl(bucket: string, key: string): string {
  return `${baseURL || ''}/s3/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}?download=true`
}
