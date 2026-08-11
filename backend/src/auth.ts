import type { Request, Response, NextFunction } from 'express'
import { config } from './config.js'

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  if (!config.apiKey) {
    return next()
  }
  const key =
    req.headers['x-api-key'] ||
    req.headers['authorization']?.toString().replace(/^Bearer\s+/i, '')
  if (key !== config.apiKey) {
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
  if (key === config.apiKey) {
    ;(req as any).authenticated = true
  }
  next()
}
