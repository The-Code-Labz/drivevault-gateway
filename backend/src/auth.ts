import type { Request, Response, NextFunction } from 'express'
import { timingSafeEqual } from 'crypto'
import { config } from './config.js'

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    // Compare against itself to keep timing consistent, then report mismatch.
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  if (!config.apiKey) {
    return next()
  }
  const key =
    req.headers['x-api-key'] ||
    req.headers['authorization']?.toString().replace(/^Bearer\s+/i, '') ||
    // Plain <a href>/<img src> browser navigations can't attach custom
    // headers, so download/preview links pass the key as a query param
    // instead. Header form still wins if both are present.
    (req.query.key as string | undefined)
  if (typeof key !== 'string' || !safeCompare(key, config.apiKey)) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing x-api-key header' })
  }
  next()
}

export function optionalApiKey(req: Request, res: Response, next: NextFunction) {
  if (!config.apiKey) {
    return next()
  }
  const key =
    req.headers['x-api-key'] ||
    req.headers['authorization']?.toString().replace(/^Bearer\s+/i, '')
  if (typeof key === 'string' && safeCompare(key, config.apiKey)) {
    ;(req as any).authenticated = true
  }
  next()
}
