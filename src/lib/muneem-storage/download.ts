import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, s3Bucket } from './s3';

export async function downloadToBuffer(key: string): Promise<Buffer> {
  const res = await s3Client.send(new GetObjectCommand({ Bucket: s3Bucket, Key: key }));
  if (!res.Body) throw new Error(`S3 object ${key} has no body`);
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
