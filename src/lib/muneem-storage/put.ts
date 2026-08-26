import { PutObjectCommand } from "@aws-sdk/client-s3";
import { isS3Configured, s3Bucket, s3Client } from "./s3";
import { StorageNotConfiguredError } from "./presign";

export async function putObjectBytes(input: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  if (!isS3Configured()) throw new StorageNotConfiguredError();
  await s3Client.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
}
