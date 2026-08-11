import { Router } from 'express'
import { driveAdapter } from './drive.js'
import { requireApiKey } from './auth.js'
import type { Request, Response } from 'express'

const router = Router()

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'drivevault-gateway' })
})

router.get('/buckets', async (_req: Request, res: Response) => {
  try {
    const buckets = await driveAdapter.listBuckets()
    res.json({ buckets })
  } catch (err) {
    console.error('Failed to list buckets:', err)
    res.status(500).json({ error: 'Failed to list buckets' })
  }
})

// Mutating routes require an API key when one is configured (see config.apiKey).
router.post('/buckets/:name', requireApiKey, async (req: Request, res: Response) => {
  try {
    const id = await driveAdapter.ensureBucket(req.params.name)
    res.json({ name: req.params.name, id })
  } catch (err) {
    console.error('Failed to create bucket:', err)
    res.status(500).json({ error: 'Failed to create bucket' })
  }
})

router.get('/buckets/:bucket/objects', async (req: Request, res: Response) => {
  try {
    const prefix = (req.query.prefix as string) || ''
    const result = await driveAdapter.listObjects(req.params.bucket, prefix)
    res.json(result)
  } catch (err) {
    console.error('Failed to list objects:', err)
    res.status(500).json({ error: 'Failed to list objects' })
  }
})

router.delete('/buckets/:bucket/objects/:key(*)', requireApiKey, async (req: Request, res: Response) => {
  try {
    const key = decodeURIComponent(req.params.key)
    const deleted = await driveAdapter.deleteObject(req.params.bucket, key)
    if (!deleted) return res.status(404).json({ error: 'Not found' })
    res.status(204).end()
  } catch (err) {
    console.error('Failed to delete object:', err)
    res.status(500).json({ error: 'Failed to delete object' })
  }
})

export default router
