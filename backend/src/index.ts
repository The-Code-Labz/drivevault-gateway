import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import { requireApiKey, optionalApiKey } from './auth.js'
import s3Router from './s3router.js'
import webRouter from './webRouter.js'

const app = express()

app.use(cors({ origin: config.corsOrigin }))

// Public web API (read-only without key if configured)
app.use('/api', express.json(), optionalApiKey, webRouter)

// S3-compatible API (auth required if API_KEY set)
// Raw request body is streamed directly to Google Drive; no body parser here.
app.use('/s3', requireApiKey, s3Router)

// Web UI static files
if (config.nodeEnv === 'production') {
  app.use(express.static('../frontend/dist'))
  app.get('*', (_req, res) => {
    res.sendFile('index.html', { root: '../frontend/dist' })
  })
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error', message: err.message })
})

app.listen(config.port, () => {
  console.log(`DriveVault Gateway running on http://localhost:${config.port}`)
  console.log(`S3 endpoint: ${config.s3.endpoint}/s3`)
  console.log(`Web API:     ${config.s3.endpoint}/api`)
})
