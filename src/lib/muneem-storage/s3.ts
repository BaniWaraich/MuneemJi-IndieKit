import { S3Client } from '@aws-sdk/client-s3';

const endpoint = process.env.S3_ENDPOINT;

export const s3Client = new S3Client({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  endpoint: endpoint || undefined,
  forcePathStyle: Boolean(endpoint),
  credentials:
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
});

export const s3Bucket = process.env.AWS_BUCKET_NAME ?? process.env.AWS_S3_BUCKET ?? 'muneem-documents';
