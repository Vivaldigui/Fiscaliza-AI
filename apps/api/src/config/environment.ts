import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3001),
    APP_ORIGIN: z.string().url().default('http://localhost:3000'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    ENABLE_SWAGGER: booleanFromString.default('true'),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    MINIO_ENDPOINT: z.string().min(1),
    MINIO_PORT: z.coerce.number().int().positive().default(9000),
    MINIO_USE_SSL: booleanFromString,
    MINIO_ACCESS_KEY: z.string().min(1),
    MINIO_SECRET_KEY: z.string().min(1),
    MINIO_BUCKET: z.string().min(3),
    MINIO_REGION: z.string().default('us-east-1'),
    MINIO_PUBLIC_ENDPOINT: z.string().url().optional(),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    COOKIE_SECURE: booleanFromString,
    COOKIE_DOMAIN: z.string().optional(),
    DOCUMENT_UPLOAD_TEMP_PATH: z.string().min(1).default('./data/uploads'),
    DOCUMENT_INBOX_PATH: z.string().min(1).default('./data/inbox'),
    DOCUMENT_MAX_SIZE_MB: z.coerce.number().int().min(1).max(500).default(25),
    DOCUMENT_MAX_PAGES: z.coerce.number().int().min(1).max(10_000).default(500),
    DOCUMENT_PROCESSING_TIMEOUT: z.coerce.number().int().min(10_000).default(300_000),
    DOCUMENT_WATCHER_ENABLED: booleanFromString,
    DOCUMENT_WATCHER_STABILITY_MS: z.coerce.number().int().min(500).default(5_000),
    DOCUMENT_WATCHER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(500),
    DOCUMENT_ANTIVIRUS_ENABLED: booleanFromString,
    DOCUMENT_ANTIVIRUS_REQUIRED: booleanFromString,
    CLAMAV_HOST: z.string().min(1).default('clamav'),
    CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(120_000),
    DOCUMENT_OCR_ENABLED: booleanFromString,
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
    SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
    DOCUMENT_QUEUE_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    DOCUMENT_QUEUE_BACKOFF_MS: z.coerce.number().int().min(100).default(5_000),
    DOCUMENT_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(1_000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
    CONVERSATION_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(1_800),
    WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3002),
    AI_PROCESSING_ENABLED: booleanFromString,
    LLM_PROVIDER: z.enum(['anthropic', 'openai', 'fake']).default('fake'),
    WHATSAPP_ENABLED: booleanFromString,
    WHATSAPP_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(604_800).default(3_600),
    WHATSAPP_INBOUND_MAX_AGE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
    WHATSAPP_INBOUND_MAX_BODY_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(102_400)
      .default(16_384),
    WHATSAPP_RATE_LIMIT: z.coerce.number().int().min(1).max(1_000).default(20),
    N8N_WEBHOOK_BASE_URL: z.string().url().optional(),
    N8N_WEBHOOK_SECRET: z.string().min(16).optional(),
    N8N_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(10_000),
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
        message: 'deve estar habilitado quando antivírus é obrigatório em produção',
      });
    }
    if (value.DOCUMENT_CHUNK_OVERLAP >= value.DOCUMENT_CHUNK_SIZE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DOCUMENT_CHUNK_OVERLAP'],
        message: 'deve ser menor que DOCUMENT_CHUNK_SIZE',
      });
    }
    if (value.WHATSAPP_ENABLED) {
      if (!value.N8N_WEBHOOK_SECRET) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['N8N_WEBHOOK_SECRET'],
          message: 'obrigatório quando WHATSAPP_ENABLED=true',
        });
      }
      if (!value.N8N_WEBHOOK_BASE_URL) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['N8N_WEBHOOK_BASE_URL'],
          message: 'obrigatória quando WHATSAPP_ENABLED=true',
        });
      }
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(config: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(config);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Configuração de ambiente inválida:\n${details.join('\n')}`);
  }
  return result.data;
}
