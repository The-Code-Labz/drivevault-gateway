import { drive_v3, google } from 'googleapis'
import { Readable } from 'stream'
import { config } from './config.js'
import { writeStoredOAuthConfig } from './oauthStore.js'

export interface DriveObject {
  key: string
  name: string
  size?: string
  lastModified?: string
  etag?: string
  contentType?: string
  isFolder: boolean
}

export interface DriveBucket {
  name: string
  id: string
  createdTime?: string
}

class DriveAdapter {
  private drive: drive_v3.Drive
  private oauth2Client?: InstanceType<typeof google.auth.OAuth2>

  constructor() {
    if (config.google.authMode === 'oauth') {
      // Personal Gmail accounts: authenticate as the actual human user (via a
      // one-time OAuth consent + refresh token) so uploads draw from that
      // user's own My Drive quota. Service accounts have none, and Shared
      // Drives / domain-wide delegation require a paid Workspace org.
      //
      // A refresh token isn't required at boot — the client id/secret alone
      // are enough to start in OAuth mode; the refresh token can arrive
      // later via the /api/oauth/connect browser flow (see oauthRouter.ts),
      // which calls setOAuthCredentials() below to hot-swap it in without a
      // restart.
      const { clientId, clientSecret, refreshToken } = config.google.oauth!
      this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret)
      if (refreshToken) this.oauth2Client.setCredentials({ refresh_token: refreshToken })
      this.drive = google.drive({ version: 'v3', auth: this.oauth2Client })
    } else {
      const auth = new google.auth.GoogleAuth({
        credentials: config.google.credentials,
        scopes: ['https://www.googleapis.com/auth/drive'],
      })
      this.drive = google.drive({ version: 'v3', auth })
    }
  }

  /** Whether a usable OAuth refresh token is currently loaded (vs. just client id/secret). */
  hasOAuthCredentials(): boolean {
    return !!this.oauth2Client?.credentials?.refresh_token
  }

  /**
   * Hot-swaps the OAuth client/refresh token in place (no restart) and
   * persists it to ./data/oauth-tokens.json so it survives container
   * restarts. Called by the /api/oauth/callback route after a successful
   * browser login.
   */
  setOAuthCredentials(creds: { clientId: string; clientSecret: string; refreshToken: string }): void {
    if (config.google.authMode !== 'oauth') {
      throw new Error('Cannot set OAuth credentials while running in service_account mode.')
    }
    this.oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret)
    this.oauth2Client.setCredentials({ refresh_token: creds.refreshToken })
    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client })
    writeStoredOAuthConfig(creds)
  }

  private async rootFolderId(): Promise<string> {
    return config.google.driveFolderId
  }

  private escapeName(name: string): string {
    return name.replace(/'/g, "\\'")
  }

  async listBuckets(): Promise<DriveBucket[]> {
    const rootId = await this.rootFolderId()
    const res = await this.drive.files.list({
      q: `'${rootId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, createdTime)',
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    return (res.data.files || []).map((f) => ({
      name: f.name || '',
      id: f.id || '',
      createdTime: f.createdTime || undefined,
    }))
  }

  async ensureBucket(name: string): Promise<string> {
    const rootId = await this.rootFolderId()
    const existing = await this.drive.files.list({
      q: `'${rootId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${this.escapeName(name)}' and trashed = false`,
      fields: 'files(id)',
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    if (existing.data.files && existing.data.files.length > 0) {
      return existing.data.files[0].id!
    }
    const created = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [rootId],
      },
      fields: 'id',
      supportsAllDrives: true,
    })
    return created.data.id!
  }

  private async findPath(bucketId: string, key: string): Promise<drive_v3.Schema$File | null> {
    const parts = key.split('/').filter(Boolean)
    let parentId = bucketId

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      const query = `'${parentId}' in parents and name = '${this.escapeName(part)}' and trashed = false`
      const res = await this.drive.files.list({
        q: query,
        fields: 'files(id, name, mimeType, size, modifiedTime, md5Checksum)',
        pageSize: 10,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
      const found = res.data.files?.find((f) =>
        isLast ? f.mimeType !== 'application/vnd.google-apps.folder' : f.mimeType === 'application/vnd.google-apps.folder'
      )
      if (!found) return null
      parentId = found.id!
    }

    const res = await this.drive.files.get({
      fileId: parentId,
      fields: 'id, name, mimeType, size, modifiedTime, md5Checksum',
      supportsAllDrives: true,
    })
    return res.data
  }

  private async findOrCreateFolderPath(bucketId: string, key: string): Promise<string> {
    const parts = key.split('/').filter(Boolean)
    const folderParts = parts.slice(0, -1)
    let parentId = bucketId

    for (const part of folderParts) {
      const res = await this.drive.files.list({
        q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${this.escapeName(part)}' and trashed = false`,
        fields: 'files(id)',
        pageSize: 1,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
      if (res.data.files && res.data.files.length > 0) {
        parentId = res.data.files[0].id!
      } else {
        const created = await this.drive.files.create({
          requestBody: {
            name: part,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
          },
          fields: 'id',
          supportsAllDrives: true,
        })
        parentId = created.data.id!
      }
    }
    return parentId
  }

  async listObjects(bucketName: string, prefix = '', delimiter = '/'): Promise<{ objects: DriveObject[]; prefixes: string[] }> {
    const bucketId = await this.ensureBucket(bucketName)
    let parentId = bucketId
    const prefixParts = prefix.split('/').filter(Boolean)

    for (const part of prefixParts) {
      const res = await this.drive.files.list({
        q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${this.escapeName(part)}' and trashed = false`,
        fields: 'files(id)',
        pageSize: 1,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
      if (!res.data.files || res.data.files.length === 0) {
        return { objects: [], prefixes: [] }
      }
      parentId = res.data.files[0].id!
    }

    const res = await this.drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, size, modifiedTime, md5Checksum)',
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })

    const objects: DriveObject[] = []
    const prefixes = new Set<string>()

    for (const file of res.data.files || []) {
      const isFolder = file.mimeType === 'application/vnd.google-apps.folder'
      const key = prefix ? `${prefix}/${file.name}` : file.name!
      if (isFolder) {
        prefixes.add(key + '/')
      } else {
        objects.push({
          key,
          name: file.name!,
          size: file.size || '0',
          lastModified: file.modifiedTime || undefined,
          etag: file.md5Checksum || file.id!,
          contentType: file.mimeType || 'application/octet-stream',
          isFolder: false,
        })
      }
    }

    return { objects, prefixes: Array.from(prefixes) }
  }

  async headObject(bucketName: string, key: string): Promise<DriveObject | null> {
    const bucketId = await this.ensureBucket(bucketName)
    const file = await this.findPath(bucketId, key)
    if (!file) return null
    return {
      key,
      name: file.name!,
      size: file.size || '0',
      lastModified: file.modifiedTime || undefined,
      etag: file.md5Checksum || file.id!,
      contentType: file.mimeType || 'application/octet-stream',
      isFolder: file.mimeType === 'application/vnd.google-apps.folder',
    }
  }

  async getObject(bucketName: string, key: string): Promise<{ stream: Readable; meta: DriveObject } | null> {
    const bucketId = await this.ensureBucket(bucketName)
    const file = await this.findPath(bucketId, key)
    if (!file) return null

    const res = await this.drive.files.get(
      { fileId: file.id!, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' }
    )

    return {
      stream: res.data as unknown as Readable,
      meta: {
        key,
        name: file.name!,
        size: file.size || '0',
        lastModified: file.modifiedTime || undefined,
        etag: file.md5Checksum || file.id!,
        contentType: file.mimeType || 'application/octet-stream',
        isFolder: false,
      },
    }
  }

  async putObject(bucketName: string, key: string, stream: Readable, contentType?: string): Promise<DriveObject> {
    const bucketId = await this.ensureBucket(bucketName)
    const parentId = await this.findOrCreateFolderPath(bucketId, key)
    const fileName = key.split('/').pop()!

    const existing = await this.drive.files.list({
      q: `'${parentId}' in parents and name = '${this.escapeName(fileName)}' and trashed = false`,
      fields: 'files(id)',
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })

    let fileId: string
    const mime = contentType || 'application/octet-stream'

    if (existing.data.files && existing.data.files.length > 0) {
      fileId = existing.data.files[0].id!
      await this.drive.files.update({
        fileId,
        media: { body: stream, mimeType: mime },
        fields: 'id, name, size, modifiedTime, md5Checksum, mimeType',
        supportsAllDrives: true,
      })
    } else {
      const created = await this.drive.files.create({
        requestBody: { name: fileName, parents: [parentId] },
        media: { body: stream, mimeType: mime },
        fields: 'id, name, size, modifiedTime, md5Checksum, mimeType',
        supportsAllDrives: true,
      })
      fileId = created.data.id!
    }

    const meta = await this.drive.files.get({
      fileId,
      fields: 'id, name, size, modifiedTime, md5Checksum, mimeType',
      supportsAllDrives: true,
    })

    return {
      key,
      name: meta.data.name!,
      size: meta.data.size || '0',
      lastModified: meta.data.modifiedTime || undefined,
      etag: meta.data.md5Checksum || meta.data.id!,
      contentType: meta.data.mimeType || 'application/octet-stream',
      isFolder: false,
    }
  }

  async copyObject(srcBucket: string, srcKey: string, destBucket: string, destKey: string): Promise<DriveObject> {
    const srcBucketId = await this.ensureBucket(srcBucket)
    const srcFile = await this.findPath(srcBucketId, srcKey)
    if (!srcFile) throw new Error('NoSuchKey')

    const destBucketId = await this.ensureBucket(destBucket)
    const destParentId = await this.findOrCreateFolderPath(destBucketId, destKey)
    const destName = destKey.split('/').pop()!

    const existing = await this.drive.files.list({
      q: `'${destParentId}' in parents and name = '${this.escapeName(destName)}' and trashed = false`,
      fields: 'files(id)',
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    const existingId = existing.data.files?.[0]?.id

    // Drive's files.copy is a true server-side operation — no bytes leave
    // Drive, unlike a naive GET-then-PUT. Copy first, then retire the stale
    // target (if any) by id, so a same-key self-copy (rclone's no-op
    // "touch" resync when content is already up to date) never leaves a
    // window with zero live copies of the file if the copy step failed.
    const copied = await this.drive.files.copy({
      fileId: srcFile.id!,
      requestBody: { name: destName, parents: [destParentId] },
      fields: 'id, name, size, modifiedTime, md5Checksum, mimeType',
      supportsAllDrives: true,
    })

    if (existingId && existingId !== copied.data.id) {
      // Mirrors deleteObject's trash convention (see note below) rather
      // than a hard delete.
      await this.drive.files.update({
        fileId: existingId,
        requestBody: { trashed: true },
        supportsAllDrives: true,
      })
    }

    return {
      key: destKey,
      name: copied.data.name!,
      size: copied.data.size || '0',
      lastModified: copied.data.modifiedTime || undefined,
      etag: copied.data.md5Checksum || copied.data.id!,
      contentType: copied.data.mimeType || 'application/octet-stream',
      isFolder: false,
    }
  }

  async deleteObject(bucketName: string, key: string): Promise<boolean> {
    const bucketId = await this.ensureBucket(bucketName)
    const file = await this.findPath(bucketId, key)
    if (!file) return false
    // Use trash instead of a hard delete (files.delete). On a Shared Drive,
    // files.delete permanently removes content and requires the caller to be
    // an *organizer* (Manager role) on the parent — a role our service
    // account setup docs never ask for (we only ask for Content Manager).
    // Google surfaces that permission gap as a bare 404 "File not found"
    // rather than 403, which made this look like a missing-file bug instead
    // of a role restriction. Content Manager (and every other role that can
    // write) is permitted to trash items, so this works across all three
    // auth modes and is recoverable besides.
    await this.drive.files.update({
      fileId: file.id!,
      requestBody: { trashed: true },
      supportsAllDrives: true,
    })
    return true
  }
}

export const driveAdapter = new DriveAdapter()
