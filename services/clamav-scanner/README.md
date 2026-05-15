# muneem-clamav-scanner

Railway-hosted ClamAV scanner for Muneem Ji F03. Vercel cannot run clamd, so the scanner lives here in its own deployable.

## Contract

- `POST /scan` — body `{ s3Key, scanId, attempt?, callbackUrl? }`, header `Authorization: Bearer $SCANNER_INBOUND_SECRET`. Acks 202 immediately; performs the scan asynchronously; posts the verdict to `SCAN_CALLBACK_URL` with HMAC headers `X-Muneem-Scan-Timestamp` + `X-Muneem-Scan-Sig`.
- `GET /healthz` — process up.
- `GET /readyz` — clamd `PING` ok AND signature DB age < 24h.

The verdict body matches the existing `/api/v1/internal/scan-callback` contract (F03 §5):

```json
{
  "s3Key": "uploads/...",
  "scanId": "<statementId>:<attempt>",
  "status": "clean" | "infected" | "error",
  "reason": "...",
  "scanProviderRef": "railway-<uuid>"
}
```

## Environment

| Var                      | Required | Notes                                                     |
| ------------------------ | -------- | --------------------------------------------------------- |
| `SCANNER_INBOUND_SECRET` | yes      | Bearer Vercel must send.                                  |
| `SCAN_CALLBACK_URL`      | yes      | `https://<host>/api/v1/internal/scan-callback`            |
| `SCAN_CALLBACK_SECRET`   | yes      | HMAC secret (matches Vercel).                             |
| `AWS_REGION`             | yes      |                                                           |
| `AWS_ACCESS_KEY_ID`      | yes      | IAM principal scoped to `s3:GetObject` on uploads bucket. |
| `AWS_SECRET_ACCESS_KEY`  | yes      |                                                           |
| `S3_UPLOADS_BUCKET`      | yes      |                                                           |
| `CLAMD_HOST`             | no       | default `127.0.0.1`                                       |
| `CLAMD_PORT`             | no       | default `3310`                                            |
| `PORT`                   | no       | default `8080`                                            |
| `MAX_SCAN_BYTES`         | no       | default 25 MiB                                            |
| `SCAN_TIMEOUT_MS`        | no       | default 60_000                                            |

## Railway deploy

1. New Railway project: `muneem-clamav-scanner`.
2. Service built from this Dockerfile.
3. Mount a persistent volume at `/var/lib/clamav` (≥ 2 GB).
4. Healthcheck path: `/readyz`.
5. Replica count: 1 (cold start ≈ 30s for signature DB load).
6. Set the env vars above. `SCANNER_INBOUND_SECRET` and `SCAN_CALLBACK_SECRET` should match the values set on Vercel.

## Local

```sh
docker build -t muneem-clamav-scanner .
docker run --rm -p 8080:8080 \
  -e SCANNER_INBOUND_SECRET=dev-secret-1234567890 \
  -e SCAN_CALLBACK_URL=http://host.docker.internal:3000/api/v1/internal/scan-callback \
  -e SCAN_CALLBACK_SECRET=dev-scan-secret-placeholder-not-for-prod \
  -e AWS_REGION=ap-south-1 \
  -e AWS_ACCESS_KEY_ID=... -e AWS_SECRET_ACCESS_KEY=... \
  -e S3_UPLOADS_BUCKET=muneem-uploads-dev \
  muneem-clamav-scanner
```
