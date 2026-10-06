export interface Bucket {
  name: string
  id: string
  createdTime?: string
}

export interface DriveObject {
  key: string
  name: string
  size?: string
  lastModified?: string
  etag?: string
  contentType?: string
  isFolder: boolean
}

export interface ListObjectsResult {
  objects: DriveObject[]
  prefixes: string[]
}

export interface OAuthStatus {
  authMode: string
  connected: boolean
}

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'canceled'

export interface UploadTask {
  id: string
  bucket: string
  key: string
  /** Display name — just the leaf name, or `folder/leaf` when uploaded via folder/drag-drop. */
  relativePath: string
  size: number
  loaded: number
  status: UploadStatus
  error?: string
  file: File
  controller: AbortController
}
