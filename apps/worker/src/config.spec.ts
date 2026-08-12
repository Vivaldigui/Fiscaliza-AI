import { loadConfig } from './config';

const base = {
  DATABASE_URL: 'postgresql://fiscaliza:ci-only@localhost:5432/fiscaliza',
  REDIS_URL: 'redis://localhost:6379',
  MINIO_ENDPOINT: 'minio',
  MINIO_ACCESS_KEY: 'minio',
  MINIO_SECRET_KEY: 'minio',
  MINIO_BUCKET: 'fiscaliza',
};

type ParseResult = ReturnType<typeof loadConfig> | Error;

function parse(overrides: Record<string, string>): ParseResult {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return loadConfig();
  } catch (error) {
    return error as Error;
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

const failure = (result: ParseResult) => (result instanceof Error ? result.message : '');

describe('WorkerConfig (segurança de providers)', () => {
  it('aceita providers fake em desenvolvimento/testes', () => {
    const result = parse({
      NODE_ENV: 'development',
      EMBEDDINGS_ENABLED: 'true',
      EMBEDDINGS_PROVIDER: 'fake',
      AI_PROCESSING_ENABLED: 'true',
      LLM_PROVIDER: 'fake',
    });
    expect(result).not.toBeInstanceOf(Error);
  });

  it('recusa provider de embeddings fake em produção', () => {
    const result = parse({
      NODE_ENV: 'production',
      EMBEDDINGS_ENABLED: 'true',
      EMBEDDINGS_PROVIDER: 'fake',
    });
    expect(failure(result)).toContain('EMBEDDINGS_PROVIDER');
    expect(failure(result)).toContain('fake');
  });

  it('recusa provider de LLM fake em produção', () => {
    const result = parse({
      NODE_ENV: 'production',
      AI_PROCESSING_ENABLED: 'true',
      LLM_PROVIDER: 'fake',
    });
    expect(failure(result)).toContain('LLM_PROVIDER');
  });

  it('exige chave de API para provider de embeddings real', () => {
    const result = parse({
      NODE_ENV: 'production',
      EMBEDDINGS_ENABLED: 'true',
      EMBEDDINGS_PROVIDER: 'openai',
      EMBEDDINGS_API_KEY: '',
    });
    expect(failure(result)).toContain('EMBEDDINGS_API_KEY');
  });

  it('chat web exige processamento e embeddings habilitados', () => {
    const result = parse({
      NODE_ENV: 'development',
      CHAT_ENABLED: 'true',
    });
    const message = failure(result);
    expect(message).toContain('CHAT_ENABLED');
    expect(message).toContain('AI_PROCESSING_ENABLED');
    expect(message).toContain('EMBEDDINGS_ENABLED');
  });
});
