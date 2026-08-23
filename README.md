# DriveVault Gateway

Expose Google Drive as S3-compatible object storage.

DriveVault Gateway is a self-hosted web app that sits between your applications and Google Drive. It translates standard S3 REST calls (`ListBuckets`, `ListObjects`, `PutObject`, `GetObject`, `DeleteObject`, `HeadObject`) into Google Drive API operations, so you can use Google Drive storage with tools, libraries, and frontends that expect S3.

---

## What it does

- **Buckets** = top-level folders inside a Google Drive root folder.
- **Objects** = files inside those folders, with slash-separated keys (`folder/subfolder/file.txt`).
- **S3-compatible API** at `/s3` — works with curl, AWS SDK, boto3, rclone, Cyberduck, etc.
- **Web UI** at `/` for browsing buckets, uploading, downloading, and deleting.

---

## Quick start

```bash
git clone https://github.com/The-Code-Labz/drivevault-gateway.git
cd drivevault-gateway
cp .env.example .env
# edit .env with your Google service account credentials
npm run install:all
npm run build
npm start
```

Open http://localhost:4050.

---

## Google Drive setup

DriveVault supports two auth modes. **Which one you need depends on whether
your Google account is a paid Workspace org or a regular personal Gmail —
Shared Drives (and the service-account mode below) do not exist on personal
Gmail at all.**

### Mode 1 — Service account (Google Workspace only)

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a service account: **IAM & Admin > Service Accounts > Create**.
3. Generate a JSON key for the service account and download it.
4. Enable the **Google Drive API**.
5. **Required:** create a [Google Shared Drive](https://support.google.com/a/answer/7212025) (not a regular folder) and add the service account's email as a **Content Manager**. Service accounts have zero storage quota of their own — a regular folder shared with the service account (even one it "owns") will let it create folders but every file upload will fail with `storageQuotaExceeded`. Only a real Shared Drive gives it quota, drawn from your Workspace org's pool. **Shared Drives require a paid Google Workspace subscription — personal `@gmail.com` accounts cannot create them, so this mode is not usable there. Use Mode 2 instead.**
6. Copy the Shared Drive's top-level folder ID from the URL (`https://drive.google.com/drive/folders/FOLDER_ID`) into `GOOGLE_DRIVE_ROOT_FOLDER_ID`. Do not leave this as `root`.

Put the service account JSON into `.env`:

```bash
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

Or mount it as a file and set:

```bash
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=/app/data/service-account.json
```

### Mode 2 — OAuth user credentials (personal Gmail)

For a regular personal Gmail account, skip the service account entirely.
DriveVault instead authenticates as *you* (via a one-time OAuth consent),
so uploads count against your own Drive storage quota — the same quota you
see in the normal Drive UI. No Shared Drive, no Workspace subscription
needed.

1. In [Google Cloud Console](https://console.cloud.google.com/), enable the **Google Drive API** on your project (same as above — a personal Gmail account can still own a Cloud project for free).
2. **APIs & Services > OAuth consent screen** — choose **External**, fill in the required fields, and add your own Gmail address as a **Test user**.
   - ⚠️ **Testing mode caps refresh tokens at 7 days** — they silently die and every Drive call starts failing with `invalid_grant` a week after you connect. Once you're happy it works, go back to **OAuth consent screen > Publish App** (Testing → In production). DriveVault requests only `drive.file` (Google's **non-sensitive** scope — access limited to files/folders the app itself creates), so publishing needs **no CASA security verification at all**, not even the "unverified app" click-through. After publishing, the refresh token only expires if revoked, unused for 6 months, or your Google password changes — no periodic re-auth or cron job needed.
3. **APIs & Services > Credentials > Create Credentials > OAuth client ID** — application type **Web application**. Under **Authorized redirect URIs**, add:
   ```
   https://your-drivevault-domain.example.com/api/oauth/callback
   ```
   (or `http://localhost:4050/api/oauth/callback` for local testing). This must match `OAUTH_REDIRECT_BASE_URL` below exactly.
4. Copy the generated **Client ID** and **Client secret** into `.env`:
   ```bash
   GOOGLE_OAUTH_CLIENT_ID=...
   GOOGLE_OAUTH_CLIENT_SECRET=...
   OAUTH_REDIRECT_BASE_URL=https://your-drivevault-domain.example.com
   ```
   Unlike the refresh token, these never expire on their own — safe to set once and leave in `.env`.
5. `docker compose up -d` (or restart) so the server picks up the two vars and boots in OAuth mode.
6. Open `http://<your-host>/api/oauth/connect` in a browser (append `?key=YOUR_API_KEY` if `API_KEY` is set). Log in with the Gmail account you want DriveVault to use and approve access. You're redirected straight back and the refresh token is written to `./data/oauth-tokens.json` automatically — **no copy-paste, no restart, no terminal.**
7. **Leave `GOOGLE_DRIVE_ROOT_FOLDER_ID` unset/`root`.** Under `drive.file` scope, the app can only see folders it created itself via the API — `root` is a special Drive alias (not a real file object), so anything the app creates as a child of it is automatically visible. Pointing this at a folder you made by hand in the Drive UI beforehand will make that folder (and anything in it) invisible to the app.
   - Already connected before this scope changed (or migrating from Mode 1)? Hit `/api/oauth/connect` again once to re-consent under the narrower `drive.file` scope — the old refresh token still technically works but was minted under the broader `drive` scope.

Check connection status anytime: `GET /api/oauth/status` → `{"authMode":"oauth","connected":true}`.

**No terminal, only have client ID/secret?** `/api/oauth/connect` also accepts `?client_id=...&client_secret=...` directly on the URL (e.g. from a custom "Connect Google Drive" form in your own frontend) — those get round-tripped through Google's flow and don't need to be in `.env` at all first.

<details>
<summary>Fallback: terminal-based scripts (only needed if you can't reach the server on a browsable port at all)</summary>

```bash
cd backend
# From a machine with a browser, redirect URI http://localhost:53682/oauth2callback:
GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... npm run oauth:token
# OR headless (SSH/CI), OAuth client type "TVs and Limited Input devices", no redirect URI:
GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... npm run oauth:token:device
```
Both print `GOOGLE_OAUTH_REFRESH_TOKEN=...` to paste into `.env` manually. Both also request the `drive.file` scope. Same 7-day Testing-mode cap applies — publish the app to avoid it (no verification needed for this scope, see above).
</details>

**Why there's no "auto-renew every 7 days" cron job:** the 7-day expiry only exists in Testing mode, and there is no way to script past it — Google's device/web OAuth flows both require an actual human to click "Allow" in a browser each time, by design (that's the whole security model). A cron job can't click that button, so "automate the renewal" really means "eliminate the need for renewal" — i.e. publish the app (step 2 above). Once published, the already-implemented `googleapis` client auto-refreshes the short-lived *access* token from the long-lived *refresh* token on every single API call — that part has always been automatic, no script needed.

---

## S3 API examples

### List buckets

```bash
curl -H "x-api-key: $API_KEY" http://localhost:4050/s3/
```

### List objects in a bucket

```bash
curl -H "x-api-key: $API_KEY" "http://localhost:4050/s3/my-bucket?prefix=folder/"
```

### Upload a file

```bash
curl -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @photo.jpg \
  "http://localhost:4050/s3/my-bucket/photos/photo.jpg"
```

### Download a file

```bash
curl -H "x-api-key: $API_KEY" \
  "http://localhost:4050/s3/my-bucket/photos/photo.jpg" \
  -o photo.jpg
```

### Delete a file

```bash
curl -X DELETE -H "x-api-key: $API_KEY" \
  "http://localhost:4050/s3/my-bucket/photos/photo.jpg"
```

---

## AWS SDK example (boto3)

```python
import boto3

s3 = boto3.client(
    's3',
    endpoint_url='http://localhost:4050/s3',
    aws_access_key_id='x-api-key',
    aws_secret_access_key='your-api-key',
)

s3.list_buckets()
s3.list_objects_v2(Bucket='my-bucket', Prefix='folder/')
s3.upload_file('photo.jpg', 'my-bucket', 'photos/photo.jpg')
s3.download_file('my-bucket', 'photos/photo.jpg', 'photo.jpg')
```

> Note: DriveVault does **not** verify AWS signatures. The `x-api-key` header is the only auth mechanism.

---

## Docker

```bash
cp .env.example .env
# fill in credentials
docker compose up -d
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4050` | HTTP port |
| `API_KEY` | — | Optional API key for `/s3` and write endpoints |
| `CORS_ORIGIN` | `*` | CORS origin |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | — | Mode 1 (Workspace): service account JSON string |
| `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` | — | Mode 1 (Workspace): path to service account JSON file |
| `GOOGLE_OAUTH_CLIENT_ID` | — | Mode 2 (personal Gmail): OAuth client ID (Web application type). Setting this + the secret puts the server into OAuth mode, overriding Mode 1. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | — | Mode 2 (personal Gmail): OAuth client secret |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | — | Mode 2 (personal Gmail): optional — normally obtained via the `/api/oauth/connect` browser flow instead (written to `./data/oauth-tokens.json`, not `.env`). Set this only if using the terminal fallback scripts. |
| `OAUTH_REDIRECT_BASE_URL` | request host | Mode 2: public base URL DriveVault is reachable at, e.g. `https://drive.example.com`. Must exactly match the redirect URI registered on the OAuth client (`<this>/api/oauth/callback`). Falls back to the incoming request's own host if unset — fine for local testing, but set this explicitly behind a reverse proxy/CDN. |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | `root` | Folder that holds buckets. Mode 1: MUST be a real Shared Drive folder ID — leaving this as `root` fails every upload with `storageQuotaExceeded` (service accounts have no My Drive quota). Mode 2: leave as `root` (default) — the app only sees folders it creates itself under `drive.file` scope, and `root` is a safe alias any child of which stays visible; pointing this at a manually-created folder instead makes it invisible to the app. |
| `S3_ENDPOINT` | `http://localhost:4050` | Endpoint advertised to clients |
| `S3_REGION` | `us-east-1` | S3 region string |

---

## Architecture

```
┌─────────────┐     S3 REST     ┌─────────────────────┐     Google Drive API     ┌─────────────┐
│  Your apps  │ ◄──────────────► │  DriveVault Gateway │ ◄──────────────────────► │ Google Drive │
└─────────────┘                  └─────────────────────┘                          └─────────────┘
                                        │
                                        ▼
                                  React web UI
```

---

## Roadmap

- [ ] Multipart upload support
- [ ] S3 presigned URLs
- [ ] Public bucket / object ACLs
- [ ] Drive shared-drive support improvements
- [ ] Metrics and logging

---

## License

MIT
