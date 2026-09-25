import { Router } from 'express'
import { driveAdapter } from './drive.js'
import type { Request, Response } from 'express'

const router = Router()

// HTTP headers (Last-Modified, Date, etc.) require RFC 1123 format
// ("Mon, 02 Jan 2006 15:04:05 GMT"), not raw ISO-8601. The AWS SDK/rclone
// parse this header strictly and fail the whole request if it doesn't match,
// even though the same timestamp inside the XML body is correctly ISO-8601.
function toHttpDate(iso?: string): string {
  const d = iso ? new Date(iso) : new Date()
  return (isNaN(d.getTime()) ? new Date() : d).toUTCString()
}

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
    console.error('ListBuckets failed:', err)
    res.status(500).json({ error: 'ListBuckets failed' })
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
    console.error('ListObjects failed:', err)
    res.status(500).json({ error: 'ListObjects failed' })
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
    res.set('Last-Modified', toHttpDate(meta.lastModified))
    res.status(200).end()
  } catch (err) {
    console.error('HeadObject failed:', err)
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
    res.set('Last-Modified', toHttpDate(meta.lastModified))
    if (req.query.download === 'true') {
      res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(meta.name)}"`)
    }
    stream.pipe(res)
  } catch (err) {
    console.error('GetObject failed:', err)
    res.status(500).json({ error: 'GetObject failed' })
  }
})

// PUT /{bucket}/{key} — PutObject, or CopyObject when x-amz-copy-source is set.
// rclone issues a same-key server-side copy (no request body) to refresh
// metadata on a no-op resync instead of re-uploading unchanged bytes; without
// this branch that request fell through to putObject and tried to write an
// empty body over the real file.
router.put('/:bucket/:key(*)', async (req: Request, res: Response) => {
  const { bucket, key } = parseBucketKey(req)
  const copySourceHeader = req.headers['x-amz-copy-source']
  if (copySourceHeader) {
    const copySource = Array.isArray(copySourceHeader) ? copySourceHeader[0] : copySourceHeader
    let decoded: string
    try {
      decoded = decodeURIComponent(copySource).replace(/^\/+/, '')
    } catch {
      return res.status(400).json({
        error: 'InvalidArgument',
        message: 'x-amz-copy-source is not validly URI-encoded',
      })
    }
    // Strip a ?versionId=... suffix — this gateway has no object versioning,
    // so the source is identified by bucket/key alone.
    decoded = decoded.split('?')[0]
    const slash = decoded.indexOf('/')
    const srcBucket = slash === -1 ? '' : decoded.slice(0, slash)
    const srcKey = slash === -1 ? '' : decoded.slice(slash + 1)
    if (!srcBucket || !srcKey) {
      return res.status(400).json({
        error: 'InvalidArgument',
        message: 'x-amz-copy-source must be in the form /bucket/key',
      })
    }
    try {
      const meta = await driveAdapter.copyObject(srcBucket, srcKey, bucket, key)
      res.set('Content-Type', 'application/xml')
      // CopyObjectResult is XML per spec, unlike PutObject's response below —
      // the AWS SDK/rclone parse this body as XML and will fail the request
      // if it isn't.
      res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<CopyObjectResult>
  <LastModified>${meta.lastModified || new Date().toISOString()}</LastModified>
  <ETag>"${xmlEscape(meta.etag || '')}"</ETag>
</CopyObjectResult>`)
    } catch (err) {
      console.error('CopyObject failed:', err)
      if (err instanceof Error && err.message === 'NoSuchKey') {
        return res.status(404).json({ error: 'NoSuchKey', message: `Source object not found: ${copySource}` })
      }
      res.status(500).json({ error: 'CopyObject failed' })
    }
    return
  }

  try {
    const meta = await driveAdapter.putObject(bucket, key, req, req.headers['content-type'])
    res.set('ETag', `"${meta.etag}"`)
    res.status(200).json({
      ETag: meta.etag,
      Key: meta.key,
      Bucket: bucket,
    })
  } catch (err) {
    console.error('PutObject failed:', err)
    res.status(500).json({ error: 'PutObject failed' })
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
    if (err instanceof Error && err.message === 'DirectoryNotEmpty') {
      return res.status(409).json({ error: 'DirectoryNotEmpty', message: `Folder not empty: ${key}` })
    }
    console.error('DeleteObject failed:', err)
    res.status(500).json({ error: 'DeleteObject failed' })
  }
})

export default router
