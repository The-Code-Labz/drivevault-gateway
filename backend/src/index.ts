import express from 'express'
import cors from 'cors'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js'
import { requireApiKey, optionalApiKey } from './auth.js'
import s3Router from './s3router.js'
import webRouter from './webRouter.js'
import oauthRouter from './oauthRouter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const frontendDist = join(__dirname, '../../frontend/dist')

const app = express()

app.use(cors({ origin: config.corsOrigin }))

// One-click Google OAuth login flow (browser redirects, no custom headers
// possible — its own key check is query-param based, see oauthRouter.ts).
app.use('/api/oauth', oauthRouter)

// Public web API (read-only without key if configured)
app.use('/api', express.json(), optionalApiKey, webRouter)

// S3-compatible API (auth required if API_KEY set)
// Raw request body is streamed directly to Google Drive; no body parser here.
app.use('/s3', requireApiKey, s3Router)

// Web UI static files
if (config.nodeEnv === 'production') {
  app.use(express.static(frontendDist))
  app.get('*', (_req, res) => {
    res.sendFile('index.html', { root: frontendDist })
  })
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(config.port, () => {
  console.log(`DriveVault Gateway running on http://localhost:${config.port}`)
  console.log(`S3 endpoint: ${config.s3.endpoint}/s3`)
  console.log(`Web API:     ${config.s3.endpoint}/api`)
})
