import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { DocumentObjectStorage } from '@fiscaliza/document-processing';

@Injectable()
export class ObjectStorageService implements DocumentObjectStorage {
  private readonly client: S3Client;
  private readonly signingClient: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const ssl = config.getOrThrow<boolean>('MINIO_USE_SSL');
    const host = config.getOrThrow<string>('MINIO_ENDPOINT');
    const port = config.getOrThrow<number>('MINIO_PORT');
    this.bucket = config.getOrThrow<string>('MINIO_BUCKET');
    const common = {
      region: config.getOrThrow<string>('MINIO_REGION'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.getOrThrow<string>('MINIO_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('MINIO_SECRET_KEY'),
      },
    } as const;
    this.client = new S3Client({
      endpoint: `${ssl ? 'https' : 'http'}://${host}:${port}`,
      ...common,
    });
    this.signingClient = new S3Client({
      endpoint:
        config.get<string>('MINIO_PUBLIC_ENDPOINT') ??
        `${ssl ? 'https' : 'http'}://${host}:${port}`,
      ...common,
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

  async promoteObject(currentKey: string, documentId: string, year: number): Promise<string> {
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

  createSignedDownloadUrl(
    storageKey: string,
    fileName: string,
    ttlSeconds: number,
  ): Promise<string> {
    const safeFileName = fileName.replace(/["\\\r\n]/g, '_');
    return getSignedUrl(
      this.signingClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        ResponseContentType: 'application/pdf',
        ResponseContentDisposition: `inline; filename="${safeFileName}"`,
      }),
      { expiresIn: ttlSeconds },
    );
  }
}
