import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { DocumentObjectStorage } from '@fiscaliza/document-processing';
import type { WorkerConfig } from './config';

export class WorkerObjectStorage implements DocumentObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: WorkerConfig) {
    this.bucket = config.MINIO_BUCKET;
    this.client = new S3Client({
      endpoint: `${config.MINIO_USE_SSL ? 'https' : 'http'}://${config.MINIO_ENDPOINT}:${config.MINIO_PORT}`,
      region: config.MINIO_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.MINIO_ACCESS_KEY,
        secretAccessKey: config.MINIO_SECRET_KEY,
      },
    });
  }

  async assertBucketAvailable(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async putFile(storageKey: string, filePath: string, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: createReadStream(filePath),
        ContentType: contentType,
        Metadata: { quarantine: 'true' },
      }),
    );
  }

  async deleteObject(storageKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }));
  }

  async downloadToFile(storageKey: string, destination: string): Promise<void> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }),
    );
    if (!result.Body) throw new Error('O objeto não retornou conteúdo.');
    await pipeline(result.Body as NodeJS.ReadableStream, createWriteStream(destination));
  }

  async promoteObject(currentKey: string, documentId: string, year: number): Promise<string> {
    if (currentKey.startsWith('documents/')) return currentKey;
    const destination = `documents/${year}/${documentId}/original.pdf`;
    const copySource = `${this.bucket}/${currentKey.split('/').map(encodeURIComponent).join('/')}`;
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: destination,
        CopySource: copySource,
        ContentType: 'application/pdf',
        MetadataDirective: 'REPLACE',
        Metadata: { quarantine: 'false' },
      }),
    );
    await this.deleteObject(currentKey);
    return destination;
  }
}
