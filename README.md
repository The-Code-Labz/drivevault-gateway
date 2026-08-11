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

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a service account: **IAM & Admin > Service Accounts > Create**.
3. Generate a JSON key for the service account and download it.
4. Enable the **Google Drive API**.
5. (Optional) Create a shared Drive folder and share it with the service account email.
6. Copy the folder ID from the URL (`https://drive.google.com/drive/folders/FOLDER_ID`) into `GOOGLE_DRIVE_ROOT_FOLDER_ID`.

Put the service account JSON into `.env`:

```bash
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

Or mount it as a file and set:

```bash
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=/app/data/service-account.json
```

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
| `GOOGLE_SERVICE_ACCOUNT_JSON` | — | Service account JSON string |
| `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` | — | Path to service account JSON file |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | `root` | Drive folder that holds buckets |
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
