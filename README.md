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
2. **APIs & Services > OAuth consent screen** — choose **External**, fill in the required fields, and add your own Gmail address as a **Test user**. (Test mode is fine indefinitely for personal use; no Google review needed.)
3. **APIs & Services > Credentials > Create Credentials > OAuth client ID** — pick one of two application types depending on where you'll run the helper script in step 5:
   - **Web application** (run the helper on the same machine as your browser) — under **Authorized redirect URIs**, add:
     ```
     http://localhost:53682/oauth2callback
     ```
   - **TVs and Limited Input devices** (run the helper headlessly — e.g. over SSH on the deploy server itself, with no browser or open port on that machine) — no redirect URI needed.
4. Copy the generated **Client ID** and **Client secret**.
5. Run the matching helper to mint a refresh token:
   - Web application client, from a machine with a browser:
     ```bash
     cd backend
     GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... npm run oauth:token
     ```
     Open the printed URL, log in with the Gmail account you want DriveVault to use, and approve access.
   - TVs/Limited Input client, runnable anywhere (SSH, CI, the deploy host itself):
     ```bash
     cd backend
     GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... npm run oauth:token:device
     ```
     It prints a short URL + code. Approve from *any* device (phone, laptop) — nothing needs to reach back to the machine running the script, so this is the one to use if you want an agent/automation to run it and paste the result straight into `.env` on the server.

   Either script prints the three lines you need. It's a one-time run per Google account.
6. Paste those into `.env`:
   ```bash
   GOOGLE_OAUTH_CLIENT_ID=...
   GOOGLE_OAUTH_CLIENT_SECRET=...
   GOOGLE_OAUTH_REFRESH_TOKEN=...
   ```
   Leave `GOOGLE_SERVICE_ACCOUNT_JSON`/`_PATH` blank — when OAuth vars are set they take priority and the service account path is skipped entirely.
7. `GOOGLE_DRIVE_ROOT_FOLDER_ID` can now be any regular folder ID in your own Drive, or left blank/`root` to use your My Drive root directly — both work, since you have real quota.

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
| `GOOGLE_OAUTH_CLIENT_ID` | — | Mode 2 (personal Gmail): OAuth client ID. Overrides Mode 1 when set with the two vars below. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | — | Mode 2 (personal Gmail): OAuth client secret |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | — | Mode 2 (personal Gmail): refresh token, minted via `npm run oauth:token` |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | `root` | Folder that holds buckets. Mode 1: MUST be a real Shared Drive folder ID — leaving this as `root` fails every upload with `storageQuotaExceeded` (service accounts have no My Drive quota). Mode 2: any folder in your own Drive, or `root` for your My Drive root — both fine, since you have real quota. |
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
