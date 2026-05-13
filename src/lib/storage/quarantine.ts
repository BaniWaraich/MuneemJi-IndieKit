/**
 * F03: move an infected S3 object out of the uploads/ namespace and into
 * quarantine/. Copy-then-delete. Returns the new key.
 *
 * Strategy (V1, per F03 §7): same bucket, `quarantine/` prefix. Bucket-level
 * lifecycle rule auto-deletes from quarantine/ after 90 days (infra-owned).
 */

import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, s3Bucket } from "@/lib/muneem-storage/s3";

export async function quarantineS3Object(originalKey: string): Promise<string> {
  // Use a stable mapping so quarantined keys are predictable in forensics.
  // Preserve the original key so reverse lookup is trivial.
  const quarantineKey = originalKey.startsWith("quarantine/")
    ? originalKey
    : `quarantine/${originalKey}`;

  await s3Client.send(
    new CopyObjectCommand({
      Bucket: s3Bucket,
      CopySource: `${s3Bucket}/${originalKey}`,
      Key: quarantineKey,
    }),
  );

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: s3Bucket,
      Key: originalKey,
    }),
  );

  return quarantineKey;
}
