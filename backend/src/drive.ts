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

const FOLDER_MIME = 'application/vnd.google-apps.folder'

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

  /** Walks a split path from `bucketId`, one segment per Drive `files.list`
   * call. `leafMode` constrains what the FINAL segment is allowed to match
   * (every non-final segment must always be a folder, same as before):
   *   'file'   — leaf must NOT be a folder (findPath's old behavior)
   *   'folder' — leaf must be a folder (findFolder's old behavior)
   *   'any'    — leaf may be either (listObjects' prefix walk, which only
   *              ever resolves folders anyway since prefixes are folders)
   * Returns the resolved id, or null if any segment (including the leaf)
   * doesn't exist under the required constraint. An empty `parts` list
   * resolves to `bucketId` itself unchanged (matches the pre-refactor
   * zero-iteration behavior of the original findPath).
   */
  private async walkPath(
    bucketId: string,
    parts: string[],
    leafMode: 'file' | 'folder' | 'any'
  ): Promise<string | null> {
    let parentId = bucketId
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      const res = await this.drive.files.list({
        q: `'${parentId}' in parents and name = '${this.escapeName(part)}' and trashed = false`,
        fields: 'files(id, name, mimeType, size, modifiedTime, md5Checksum)',
        pageSize: 10,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
      const found = res.data.files?.find((f) => {
        if (!isLast) return f.mimeType === FOLDER_MIME
        if (leafMode === 'file') return f.mimeType !== FOLDER_MIME
        if (leafMode === 'folder') return f.mimeType === FOLDER_MIME
        return true
      })
      if (!found) return null
      parentId = found.id!
    }
    return parentId
  }

  private async findPath(bucketId: string, key: string): Promise<drive_v3.Schema$File | null> {
    const parts = key.split('/').filter(Boolean)
    const fileId = await this.walkPath(bucketId, parts, 'file')
    if (!fileId) return null
    const res = await this.drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size, modifiedTime, md5Checksum, parents',
      supportsAllDrives: true,
    })
    return res.data
  }

  /** Resolves a key to a folder's Drive id (not a file). Returns null if any
   * path segment is missing, or the key is empty (bucket root isn't a
   * deletable "object"). */
  private async findFolder(bucketId: string, key: string): Promise<string | null> {
    const parts = key.split('/').filter(Boolean)
    if (parts.length === 0) return null
    return this.walkPath(bucketId, parts, 'folder')
  }

  /** Lists the live (non-trashed) direct children of a Drive folder. This is
   * the single source of truth for "what counts as occupying a folder" —
   * both folderHasChildren (existence check) and listObjects (full listing)
   * call this rather than keeping their own copies of the same query, so
   * they can't silently drift on the trashed-filter or the mimeType scope. */
  private async listLiveChildren(
    folderId: string,
    fields: string,
    pageSize: number
  ): Promise<drive_v3.Schema$File[]> {
    const res = await this.drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields,
      pageSize,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    return res.data.files || []
  }

  private async folderHasChildren(folderId: string): Promise<boolean> {
    const children = await this.listLiveChildren(folderId, 'files(id)', 1)
    return children.length > 0
  }

  /** Walks up from `startFolderId`, trashing every now-empty folder, and
   * stops at `bucketId` (the bucket root is never trashed here). Called
   * after deleting the last file/folder in a parent so DriveVault doesn't
   * leak permanently empty folders — unlike true S3, a Drive folder is a
   * real object that outlives every file that was ever inside it.
   *
   * This is check-then-act with no locking, so a concurrent write into the
   * same folder (e.g. a racing putObject/copyObject) can land between the
   * emptiness check and the trash call. To narrow that window, we re-check
   * immediately after trashing and un-trash if something arrived in the
   * interim — Drive excludes children of a trashed folder from
   * "'<id>' in parents and trashed=false" queries even when the child's own
   * `trashed` flag is false, so leaving a stale trash in place would make a
   * real, live file invisible to every list/head/get call. This bounds the
   * race to one extra round-trip; it does not eliminate it. */
  private async trashEmptyAncestors(bucketId: string, startFolderId: string): Promise<void> {
    let folderId: string | undefined = startFolderId
    let guard = 0
    while (folderId && folderId !== bucketId) {
      guard++
      if (guard > 50) {
        console.warn(
          `trashEmptyAncestors: depth guard (50) hit walking up from ${startFolderId}; stopping without further cleanup`
        )
        break
      }
      if (await this.folderHasChildren(folderId)) break
      const info: { data: drive_v3.Schema$File } = await this.drive.files.get({
        fileId: folderId,
        fields: 'parents',
        supportsAllDrives: true,
      })
      const nextParent: string | undefined = info.data.parents?.[0] ?? undefined
      await this.drive.files.update({
        fileId: folderId,
        requestBody: { trashed: true },
        supportsAllDrives: true,
      })
      if (await this.folderHasChildren(folderId)) {
        await this.drive.files.update({
          fileId: folderId,
          requestBody: { trashed: false },
          supportsAllDrives: true,
        })
        break
      }
      folderId = nextParent
    }
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

  /** Recursively descends every live subfolder under `folderId`, collecting
   * every file (never folders) as a DriveObject with its full key relative
   * to the bucket root. Used for delimiter-less (flat/recursive) listings —
   * the S3 default when a client omits `delimiter` entirely, which is what
   * `rclone lsjson -R` / `rclone check` / `aws s3 ls --recursive` send. */
  private async collectObjectsRecursive(
    folderId: string,
    keyPrefix: string,
    out: DriveObject[]
  ): Promise<void> {
    const files = await this.listLiveChildren(
      folderId,
      'files(id, name, mimeType, size, modifiedTime, md5Checksum)',
      1000
    )
    for (const file of files) {
      const key = keyPrefix ? `${keyPrefix}${file.name}` : file.name!
      if (file.mimeType === FOLDER_MIME) {
        await this.collectObjectsRecursive(file.id!, `${key}/`, out)
      } else {
        out.push({
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
  }

  /** `delimiter` follows real S3 semantics: `'/'` (the conventional value,
   * also the default when a client omits the param on a "browse one level"
   * call) groups subfolders into `CommonPrefixes` and does not descend into
   * them. Anything else — including an explicitly empty string, and actual
   * omission by the caller — means "no delimiter": a flat, fully recursive
   * listing with every file's full key and no CommonPrefixes at all, which
   * is what a real S3 client sends for a recursive listing. Previously this
   * method silently ignored its own `delimiter` parameter (the router never
   * even forwarded the client's query value) and always did the one-level
   * walk, so any file more than one folder below `prefix` was invisible to
   * every listing call even though HeadObject/GetObject on its exact key
   * worked fine. */
  async listObjects(
    bucketName: string,
    prefix = '',
    delimiter?: string
  ): Promise<{ objects: DriveObject[]; prefixes: string[] }> {
    const bucketId = await this.ensureBucket(bucketName)
    const prefixParts = prefix.split('/').filter(Boolean)
    const parentId =
      prefixParts.length === 0 ? bucketId : await this.walkPath(bucketId, prefixParts, 'folder')
    if (!parentId) {
      return { objects: [], prefixes: [] }
    }

    // S3 clients (rclone included) conventionally pass a trailing slash on
    // `prefix` when listing a "directory" — naively appending another '/'
    // here produced double-slash keys (e.g. "foo//bar.txt") on every such
    // listing. Only insert the separator when prefix doesn't already end
    // with one.
    const prefixJoin = prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix

    if (delimiter !== '/') {
      const objects: DriveObject[] = []
      await this.collectObjectsRecursive(parentId, prefixJoin, objects)
      return { objects, prefixes: [] }
    }

    const files = await this.listLiveChildren(
      parentId,
      'files(id, name, mimeType, size, modifiedTime, md5Checksum)',
      1000
    )

    const objects: DriveObject[] = []
    const prefixes = new Set<string>()

    for (const file of files) {
      const isFolder = file.mimeType === FOLDER_MIME
      const key = prefixJoin ? `${prefixJoin}${file.name}` : file.name!
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

    // Drive's files.copy is a true server-side operation — no bytes leave
    // Drive, unlike a naive GET-then-PUT. NOTE: unlike putObject (which does
    // an in-place files.update on an existing file, keeping the same Drive
    // id), this always mints a brand-new Drive id for the destination and
    // trashes whatever occupied that key before — a real semantic
    // divergence from putObject's overwrite path. Harmless for rclone
    // (which addresses objects by key, not Drive id) but worth knowing if
    // anything elsewhere keys off Drive file id. Copy first, then clean up
    // stale duplicates, so a self-copy touch never leaves a window with
    // zero live copies of the file if the copy step fails.
    const copied = await this.drive.files.copy({
      fileId: srcFile.id!,
      requestBody: { name: destName, parents: [destParentId] },
      fields: 'id, name, size, modifiedTime, md5Checksum, mimeType',
      supportsAllDrives: true,
    })

    // List AFTER the copy (not before) and trash every match except the one
    // we just created. This both (a) cleans up more than one stale
    // duplicate if they've accumulated, and (b) self-heals a race between
    // two concurrent self-copy touches on the same key: whichever request's
    // cleanup runs last sees both new files and trashes all but its own,
    // converging to a single live copy instead of leaking an orphan.
    const existing = await this.drive.files.list({
      q: `'${destParentId}' in parents and name = '${this.escapeName(destName)}' and trashed = false`,
      fields: 'files(id)',
      pageSize: 50,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    const staleIds = (existing.data.files || [])
      .map((f) => f.id)
      .filter((id): id is string => !!id && id !== copied.data.id)
    // Mirrors deleteObject's trash convention rather than a hard delete.
    await Promise.all(
      staleIds.map((id) =>
        this.drive.files.update({
          fileId: id,
          requestBody: { trashed: true },
          supportsAllDrives: true,
        })
      )
    )

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

    // A trailing slash is the S3 convention for addressing a "directory" —
    // rclone's generic S3 backend never actually sends this (Rmdir is a
    // no-op there once a prefix lists empty), but DriveVault's folders are
    // real, persistent Drive objects, not synthesized listing prefixes, so
    // give callers (or a client with directory_markers-style behavior) an
    // explicit route to remove one once it's empty. Refuses (rather than
    // silently trashing) a folder that still has live children.
    if (key.endsWith('/')) {
      const folderId = await this.findFolder(bucketId, key)
      if (!folderId) return false
      if (await this.folderHasChildren(folderId)) {
        throw new Error('DirectoryNotEmpty')
      }
      const info: { data: drive_v3.Schema$File } = await this.drive.files.get({
        fileId: folderId,
        fields: 'parents',
        supportsAllDrives: true,
      })
      await this.drive.files.update({
        fileId: folderId,
        requestBody: { trashed: true },
        supportsAllDrives: true,
      })
      // Cascade the same way the file-delete branch below does — an
      // explicit `DELETE a/b/c/` on an already-empty `c` should also clean
      // up `b`/`a` if they're now empty too, not just `c` itself.
      const folderParentId = info.data.parents?.[0]
      if (folderParentId) await this.trashEmptyAncestors(bucketId, folderParentId)
      return true
    }

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

    // Auto-clean now-empty ancestor folders with the same trash convention —
    // deleting the last file in a folder shouldn't leave that folder (and
    // any now-empty parents above it) behind forever, since nothing else in
    // this gateway ever cleans them up.
    const parentId = file.parents?.[0]
    if (parentId) await this.trashEmptyAncestors(bucketId, parentId)

    return true
  }
}

export const driveAdapter = new DriveAdapter()
