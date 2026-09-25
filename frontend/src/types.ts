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
