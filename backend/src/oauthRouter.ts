import { Router } from 'express'
import type { Request, Response } from 'express'
import { google } from 'googleapis'
import { config } from './config.js'
import { driveAdapter } from './drive.js'

const router = Router()
const SCOPE = ['https://www.googleapis.com/auth/drive']

function checkKey(req: Request, res: Response): boolean {
  if (!config.apiKey) return true
  const key = (req.query.key as string) || req.header('x-api-key')
  if (key === config.apiKey) return true
  res.status(401).send('Unauthorized. Append ?key=YOUR_API_KEY to this URL.')
  return false
}

function redirectUri(req: Request): string {
  const base = process.env.OAUTH_REDIRECT_BASE_URL
  return base ? `${base.replace(/\/$/, '')}/api/oauth/callback` : `${req.protocol}://${req.get('host')}/api/oauth/callback`
}

// Current connection status — safe to leave unauthenticated (no secrets returned).
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    authMode: config.google.authMode,
    connected: config.google.authMode === 'oauth' && driveAdapter.hasOAuthCredentials(),
  })
})

// Kicks off the standard OAuth "Web application" login flow. Client id/secret
// come from GOOGLE_OAUTH_CLIENT_ID/SECRET in .env by default, or can be passed
// directly (e.g. from a frontend "Connect Google Drive" form) as
// ?client_id=...&client_secret=... — those are round-tripped through Google's
// `state` param so /callback below doesn't need them stored anywhere first.
router.get('/connect', (req: Request, res: Response) => {
  if (!checkKey(req, res)) return

  const clientId = (req.query.client_id as string) || config.google.oauth?.clientId
  const clientSecret = (req.query.client_secret as string) || config.google.oauth?.clientSecret
  if (!clientId || !clientSecret) {
    return res
      .status(400)
      .send(
        'No Google OAuth client configured. Provide ?client_id=...&client_secret=... on this URL, ' +
          'or set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in .env and restart. ' +
          'These come from Cloud Console > APIs & Services > Credentials > Create Credentials > ' +
          'OAuth client ID > Application type: "Web application".'
      )
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri(req))
  const state = Buffer.from(JSON.stringify({ clientId, clientSecret })).toString('base64url')
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // forces a refresh_token even on repeat consents
    scope: SCOPE,
    state,
  })
  res.redirect(url)
})

// Google redirects here after the user approves. Exchanges the one-time code
// for a refresh token and hot-swaps it into the running DriveAdapter — no
// restart required — and persists it to ./data/oauth-tokens.json.
router.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined
  const stateRaw = req.query.state as string | undefined
  if (!code) return res.status(400).send('Missing authorization code.')

  let clientId = config.google.oauth?.clientId
  let clientSecret = config.google.oauth?.clientSecret
  if (stateRaw) {
    try {
      const state = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf-8'))
      if (state.clientId) clientId = state.clientId
      if (state.clientSecret) clientSecret = state.clientSecret
    } catch {
      // malformed state — fall back to configured client id/secret
    }
  }
  if (!clientId || !clientSecret) {
    return res.status(400).send('No OAuth client configured for this callback.')
  }

  try {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri(req))
    const { tokens } = await oauth2Client.getToken(code)
    if (!tokens.refresh_token) {
      return res
        .status(400)
        .send(
          '<p>Google did not return a refresh token. This happens if you already granted this app ' +
            'access before without revoking it (Google only issues a fresh refresh token on first consent, ' +
            'or when prompt=consent is forced and no valid grant conflict exists). Go to ' +
            '<a href="https://myaccount.google.com/permissions" target="_blank">Google Account &gt; ' +
            'Third-party access</a>, remove this app, then retry ' +
            '<a href="/api/oauth/connect">/api/oauth/connect</a>.</p>'
        )
    }
    driveAdapter.setOAuthCredentials({ clientId, clientSecret, refreshToken: tokens.refresh_token })
    res.send(
      '<h2>Connected</h2><p>DriveVault is now authorized against this Google account and will stay ' +
        'authorized indefinitely (no periodic re-login needed) as long as the consent screen is in ' +
        '<b>Production</b> mode, not Testing. You can close this tab.</p>'
    )
  } catch (err) {
    console.error('OAuth callback failed:', err)
    res.status(500).send('OAuth token exchange failed. Check server logs.')
  }
})

export default router
