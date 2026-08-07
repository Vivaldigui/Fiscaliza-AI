import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

@Injectable()
export class ObjectStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const ssl = config.getOrThrow<boolean>('MINIO_USE_SSL');
    const host = config.getOrThrow<string>('MINIO_ENDPOINT');
    const port = config.getOrThrow<number>('MINIO_PORT');
    this.bucket = config.getOrThrow<string>('MINIO_BUCKET');
    this.client = new S3Client({
      endpoint: `${ssl ? 'https' : 'http'}://${host}:${port}`,
      region: config.getOrThrow<string>('MINIO_REGION'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.getOrThrow<string>('MINIO_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('MINIO_SECRET_KEY'),
      },
    });
  }

  async assertBucketAvailable(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
