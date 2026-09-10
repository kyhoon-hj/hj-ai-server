import {
  S3Client,
  ListObjectVersionsCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

export async function cleanupAwsNetworkObject(
  client: S3Client,
  bucket: string,
  key: string,
) {
  if (
    !/^aws-network-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/synthetic\.txt$/.test(
      key,
    )
  )
    throw new Error("Cleanup requires this harness's exact UUID fixture key");
  const list = () =>
    client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: key,
        MaxKeys: 100,
      }),
      { abortSignal: AbortSignal.timeout(10000) },
    );
  const existing = await list();
  const entries = [
    ...(existing.Versions ?? []),
    ...(existing.DeleteMarkers ?? []),
  ];
  if (
    existing.IsTruncated ||
    entries.some((v) => v.Key !== key || !v.VersionId)
  )
    throw new Error('Unexpected fixture version inventory; cleanup stopped');
  for (const item of entries)
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
        VersionId: item.VersionId,
      }),
      { abortSignal: AbortSignal.timeout(10000) },
    );
  const remaining = await list();
  if (
    remaining.IsTruncated ||
    remaining.Versions?.length ||
    remaining.DeleteMarkers?.length
  )
    throw new Error('Fixture versions remain after cleanup');
  return { deletedVersionsAndMarkers: entries.length, remaining: 0 };
}
