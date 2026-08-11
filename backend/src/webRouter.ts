import { Router } from 'express'
import { driveAdapter } from './drive.js'
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
    res.status(500).json({ error: 'Failed to list buckets', message: (err as Error).message })
  }
})

router.post('/buckets/:name', async (req: Request, res: Response) => {
  try {
    const id = await driveAdapter.ensureBucket(req.params.name)
    res.json({ name: req.params.name, id })
  } catch (err) {
    res.status(500).json({ error: 'Failed to create bucket', message: (err as Error).message })
  }
})

router.get('/buckets/:bucket/objects', async (req: Request, res: Response) => {
  try {
    const prefix = (req.query.prefix as string) || ''
    const result = await driveAdapter.listObjects(req.params.bucket, prefix)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'Failed to list objects', message: (err as Error).message })
  }
})

router.delete('/buckets/:bucket/objects/:key(*)', async (req: Request, res: Response) => {
  try {
    const key = decodeURIComponent(req.params.key)
    const deleted = await driveAdapter.deleteObject(req.params.bucket, key)
    if (!deleted) return res.status(404).json({ error: 'Not found' })
    res.status(204).end()
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete object', message: (err as Error).message })
  }
})

export default router
