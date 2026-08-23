#!/usr/bin/env node
// One-time helper: mints a Google OAuth refresh token for a personal Gmail
// account, so DriveVault can upload using that user's own Drive quota
// instead of a quota-less service account.
//
// Usage:
//   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... node scripts/get-google-refresh-token.mjs
//
// Requires the OAuth client's "Authorized redirect URIs" (Google Cloud
// Console -> APIs & Services -> Credentials) to include:
//   http://localhost:53682/oauth2callback

import { google } from 'googleapis'
import http from 'http'
import { URL } from 'url'

const PORT = 53682
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET env vars first.')
  process.exit(1)
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI)

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // forces a refresh_token even on repeat runs
  scope: ['https://www.googleapis.com/auth/drive.file'],
})

console.log('\n1. Open this URL in a browser logged into the Gmail account you want to use:\n')
console.log(authUrl)
console.log('\n2. Approve access. You will be redirected back to localhost — this script is listening.\n')

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, REDIRECT_URI)
    if (url.pathname !== '/oauth2callback') {
      res.writeHead(404).end()
      return
    }
    const code = url.searchParams.get('code')
    if (!code) {
      res.writeHead(400).end('Missing ?code param')
      return
    }
    const { tokens } = await oauth2Client.getToken(code)
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<h1>Done.</h1> You can close this tab and return to the terminal.')

    console.log('\nSuccess. Add these to your .env:\n')
    console.log(`GOOGLE_OAUTH_CLIENT_ID=${clientId}`)
    console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}`)
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`)
    console.log('\n(You can now remove GOOGLE_SERVICE_ACCOUNT_JSON / _PATH and')
    console.log('GOOGLE_DRIVE_ROOT_FOLDER_ID can point at a regular folder, or be left unset for root.)\n')

    server.close()
    process.exit(0)
  } catch (err) {
    console.error('Token exchange failed:', err)
    res.writeHead(500).end('Token exchange failed, see terminal.')
    server.close()
    process.exit(1)
  }
})

server.listen(PORT, () => {
  console.log(`(listening on http://localhost:${PORT} for the redirect)`)
})
