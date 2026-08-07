import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: diskStorage({
          destination: (_request, _file, callback) => {
            const destination = config.getOrThrow<string>('DOCUMENT_UPLOAD_TEMP_PATH');
            void mkdir(destination, { recursive: true })
              .then(() => callback(null, destination))
              .catch((error: unknown) => callback(error as Error, destination));
          },
          filename: (_request, _file, callback) => callback(null, `${randomUUID()}.upload`),
        }),
        limits: {
          files: 1,
          fileSize: config.getOrThrow<number>('DOCUMENT_MAX_SIZE_MB') * 1024 * 1024,
          fields: 5,
        },
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
