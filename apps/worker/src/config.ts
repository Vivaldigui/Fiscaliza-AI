import { z } from 'zod';

const booleanValue = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    MINIO_ENDPOINT: z.string().min(1),
    MINIO_PORT: z.coerce.number().int().positive().default(9000),
    MINIO_USE_SSL: booleanValue,
    MINIO_ACCESS_KEY: z.string().min(1),
    MINIO_SECRET_KEY: z.string().min(1),
    MINIO_BUCKET: z.string().min(3),
    MINIO_REGION: z.string().default('us-east-1'),
    DOCUMENT_INBOX_PATH: z.string().min(1).default('./data/inbox'),
    DOCUMENT_MAX_SIZE_MB: z.coerce.number().int().min(1).max(500).default(25),
    DOCUMENT_MAX_PAGES: z.coerce.number().int().min(1).max(10_000).default(500),
    DOCUMENT_PROCESSING_TIMEOUT: z.coerce.number().int().min(10_000).default(300_000),
    DOCUMENT_WATCHER_ENABLED: booleanValue,
    DOCUMENT_WATCHER_STABILITY_MS: z.coerce.number().int().min(500).default(5_000),
    DOCUMENT_WATCHER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(500),
    DOCUMENT_ANTIVIRUS_ENABLED: booleanValue,
    DOCUMENT_ANTIVIRUS_REQUIRED: booleanValue,
    CLAMAV_HOST: z.string().min(1).default('clamav'),
    CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(120_000),
    DOCUMENT_OCR_ENABLED: booleanValue,
    DOCUMENT_OCR_LANGUAGES: z
      .string()
      .regex(/^[a-z]{3}(\+[a-z]{3})*$/i)
      .default('por'),
    DOCUMENT_OCR_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
    DOCUMENT_OCR_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(120_000),
    DOCUMENT_TEXT_MIN_CHARACTERS: z.coerce.number().int().min(1).default(80),
    DOCUMENT_TEXT_MIN_WORDS: z.coerce.number().int().min(1).default(8),
    DOCUMENT_TEXT_MIN_QUALITY: z.coerce.number().min(0).max(1).default(0.55),
    DOCUMENT_CHUNK_SIZE: z.coerce.number().int().min(100).default(1_200),
    DOCUMENT_CHUNK_OVERLAP: z.coerce.number().int().min(0).default(150),
    DOCUMENT_QUEUE_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    DOCUMENT_QUEUE_BACKOFF_MS: z.coerce.number().int().min(100).default(5_000),
    DOCUMENT_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(1_000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
    WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3002),
    DEADLINE_SWEEP_INTERVAL_MS: z.coerce.number().int().min(10_000).default(3_600_000),
    PDF_EXTRACTOR_SCRIPT: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (
      value.NODE_ENV === 'production' &&
      value.DOCUMENT_ANTIVIRUS_REQUIRED &&
      !value.DOCUMENT_ANTIVIRUS_ENABLED
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DOCUMENT_ANTIVIRUS_ENABLED'],
        message: 'deve estar habilitado quando obrigatório em produção',
      });
    }
    if (value.DOCUMENT_CHUNK_OVERLAP >= value.DOCUMENT_CHUNK_SIZE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DOCUMENT_CHUNK_OVERLAP'],
        message: 'deve ser menor que DOCUMENT_CHUNK_SIZE',
      });
    }
  });

export type WorkerConfig = z.infer<typeof schema>;

export function loadConfig(): WorkerConfig {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      `Configuração do worker inválida:\n${result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('\n')}`,
    );
  }
  return result.data;
}
