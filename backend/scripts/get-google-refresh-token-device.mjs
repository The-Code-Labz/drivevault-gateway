#!/usr/bin/env node
// Headless alternative to get-google-refresh-token.mjs.
//
// Uses Google's OAuth 2.0 Device Authorization Grant instead of a
// localhost redirect, so it can run anywhere (SSH session, CI runner,
// remote server) with no browser or open port on the machine running it.
// You approve on a SEPARATE device (phone, laptop, whatever) by visiting
// a short URL and typing a code — nothing needs to reach back to this host.
//
// Setup (one-time, Google Cloud Console):
//   APIs & Services > Credentials > Create Credentials > OAuth client ID
//   Application type: "TVs and Limited Input devices"
//   (No redirect URI needed for this type.)
//
// Usage:
//   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
//     node scripts/get-google-refresh-token-device.mjs

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET env vars first.')
  process.exit(1)
}

const DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/drive'

async function main() {
  const deviceRes = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPE }),
  })
  const device = await deviceRes.json()
  if (!deviceRes.ok) {
    console.error('Device code request failed:', JSON.stringify(device))
    process.exit(1)
  }

  console.log('\n1. On any device with a browser, go to:\n')
  console.log(`   ${device.verification_url}`)
  console.log('\n2. Enter this code when prompted:\n')
  console.log(`   ${device.user_code}`)
  console.log(`\n(Waiting up to ${Math.round(device.expires_in / 60)} minutes for approval...)\n`)

  const intervalMs = (device.interval || 5) * 1000
  const deadline = Date.now() + device.expires_in * 1000

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs))

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        device_code: device.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })
    const tok = await tokenRes.json()

    if (tokenRes.ok) {
      console.log('Success. Add these to your .env:\n')
      console.log(`GOOGLE_OAUTH_CLIENT_ID=${clientId}`)
      console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}`)
      console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tok.refresh_token}`)
      console.log('\n(You can now remove GOOGLE_SERVICE_ACCOUNT_JSON / _PATH and')
      console.log('GOOGLE_DRIVE_ROOT_FOLDER_ID can point at a regular folder, or be left unset for root.)\n')
      process.exit(0)
    }

    if (tok.error === 'authorization_pending') continue
    if (tok.error === 'slow_down') {
      await new Promise((r) => setTimeout(r, intervalMs))
      continue
    }
    console.error('Token exchange failed:', JSON.stringify(tok))
    process.exit(1)
  }

  console.error('Timed out waiting for approval.')
  process.exit(1)
}

main()
