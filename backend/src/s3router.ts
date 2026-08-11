import { Router } from 'express'
import { driveAdapter } from './drive.js'
import type { Request, Response } from 'express'

const router = Router()

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildListBucketsXml(buckets: Awaited<ReturnType<typeof driveAdapter.listBuckets>>) {
  const bucketsXml = buckets
    .map(
      (b) => `
      <Bucket>
        <Name>${xmlEscape(b.name)}</Name>
        <CreationDate>${b.createdTime || new Date().toISOString()}</CreationDate>
      </Bucket>`
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Owner>
    <ID>drivevault</ID>
    <DisplayName>DriveVault Gateway</DisplayName>
  </Owner>
  <Buckets>${bucketsXml}
  </Buckets>
</ListAllMyBucketsResult>`
}

function buildListObjectsXml(
  bucket: string,
  objects: Awaited<ReturnType<typeof driveAdapter.listObjects>>['objects'],
  prefixes: string[],
  prefix: string
) {
  const contents = objects
    .map(
      (o) => `
      <Contents>
        <Key>${xmlEscape(o.key)}</Key>
        <LastModified>${o.lastModified || new Date().toISOString()}</LastModified>
        <ETag>"${xmlEscape(o.etag || '')}"</ETag>
        <Size>${o.size || 0}</Size>
        <StorageClass>STANDARD</StorageClass>
      </Contents>`
    )
    .join('')
  const commonPrefixes = prefixes
    .map((p) => `
      <CommonPrefixes>
        <Prefix>${xmlEscape(p)}</Prefix>
      </CommonPrefixes>`
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${xmlEscape(bucket)}</Name>
  <Prefix>${xmlEscape(prefix)}</Prefix>
  <MaxKeys>1000</MaxKeys>
  <IsTruncated>false</IsTruncated>
  <KeyCount>${objects.length}</KeyCount>${contents}${commonPrefixes}
</ListBucketResult>`
}

// Parse S3-style path from URL. Supports both virtual-host and path-style.
function parseBucketKey(req: Request): { bucket: string; key: string } {
  const path = decodeURIComponent(req.path).replace(/^\/+/, '')
  const slash = path.indexOf('/')
  if (slash === -1) {
    return { bucket: path, key: '' }
  }
  return { bucket: path.slice(0, slash), key: path.slice(slash + 1) }
}

// GET / — ListBuckets
router.get('/', async (_req: Request, res: Response) => {
  try {
    const buckets = await driveAdapter.listBuckets()
    res.set('Content-Type', 'application/xml')
    res.send(buildListBucketsXml(buckets))
  } catch (err) {
    res.status(500).json({ error: 'ListBuckets failed', message: (err as Error).message })
  }
})

// GET /{bucket} — ListObjects
router.get('/:bucket', async (req: Request, res: Response) => {
  const { bucket } = req.params
  const prefix = (req.query.prefix as string) || ''
  try {
    const { objects, prefixes } = await driveAdapter.listObjects(bucket, prefix)
    res.set('Content-Type', 'application/xml')
    res.send(buildListObjectsXml(bucket, objects, prefixes, prefix))
  } catch (err) {
    res.status(500).json({ error: 'ListObjects failed', message: (err as Error).message })
  }
})

// HEAD /{bucket}/{key} — HeadObject
router.head('/:bucket/:key(*)', async (req: Request, res: Response) => {
  const { bucket, key } = parseBucketKey(req)
  try {
    const meta = await driveAdapter.headObject(bucket, key)
    if (!meta) {
      return res.status(404).end()
    }
    res.set('Content-Length', meta.size || '0')
    res.set('Content-Type', meta.contentType || 'application/octet-stream')
    res.set('ETag', `"${meta.etag}"`)
    res.set('Last-Modified', meta.lastModified || new Date().toISOString())
    res.status(200).end()
  } catch (err) {
    res.status(500).end()
  }
})

// GET /{bucket}/{key} — GetObject
router.get('/:bucket/:key(*)', async (req: Request, res: Response) => {
  const { bucket, key } = parseBucketKey(req)
  try {
    const result = await driveAdapter.getObject(bucket, key)
    if (!result) {
      return res.status(404).json({ error: 'NoSuchKey', message: `Object not found: ${key}` })
    }
    const { stream, meta } = result
    res.set('Content-Type', meta.contentType || 'application/octet-stream')
    res.set('Content-Length', meta.size || '0')
    res.set('ETag', `"${meta.etag}"`)
    if (req.query.download === 'true') {
      res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(meta.name)}"`)
    }
    stream.pipe(res)
  } catch (err) {
    res.status(500).json({ error: 'GetObject failed', message: (err as Error).message })
  }
})

// PUT /{bucket}/{key} — PutObject
router.put('/:bucket/:key(*)', async (req: Request, res: Response) => {
  const { bucket, key } = parseBucketKey(req)
  try {
    const meta = await driveAdapter.putObject(bucket, key, req, req.headers['content-type'])
    res.set('ETag', `"${meta.etag}"`)
    res.status(200).json({
      ETag: meta.etag,
      Key: meta.key,
      Bucket: bucket,
    })
  } catch (err) {
    res.status(500).json({ error: 'PutObject failed', message: (err as Error).message })
  }
})

// DELETE /{bucket}/{key} — DeleteObject
router.delete('/:bucket/:key(*)', async (req: Request, res: Response) => {
  const { bucket, key } = parseBucketKey(req)
  try {
    const deleted = await driveAdapter.deleteObject(bucket, key)
    if (!deleted) {
      return res.status(404).json({ error: 'NoSuchKey', message: `Object not found: ${key}` })
    }
    res.status(204).end()
  } catch (err) {
    res.status(500).json({ error: 'DeleteObject failed', message: (err as Error).message })
  }
})

export default router
