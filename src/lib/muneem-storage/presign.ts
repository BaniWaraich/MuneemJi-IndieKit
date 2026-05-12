import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, s3Bucket } from './s3';

export async function presignPut(
  key: string,
  contentType: string,
  expiresSec = 900,
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: s3Bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3Client, cmd, { expiresIn: expiresSec });
}

export async function presignGet(key: string, expiresSec = 900): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: s3Bucket, Key: key });
  return getSignedUrl(s3Client, cmd, { expiresIn: expiresSec });
}
