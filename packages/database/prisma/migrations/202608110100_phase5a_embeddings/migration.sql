-- Phase 5A: document chunk embedding metadata + HNSW index.
-- No prior migration is edited. The `vector(1536)` column already exists on
-- `document_chunks` (Phase 1). This migration only adds the source metadata
-- that makes retrieval version-aware and idempotent: with it, a query can
-- (a) restrict results to the current embedding version (rollback/roll-forward
-- without deleting old vectors), and (b) skip chunks whose content hash and
-- provider/model/version already match the current index configuration.
--
-- Prisma cannot manage the `vector` type or HNSW operator-class indexes, so the
-- index is created here as raw SQL; the column itself remains `Unsupported` in
-- the schema and the generated client maps it opaquely.

ALTER TABLE "public"."document_chunks"
  ADD COLUMN "embedding_provider" VARCHAR(50),
  ADD COLUMN "embedding_model" VARCHAR(100),
  ADD COLUMN "embedding_version" VARCHAR(64),
  ADD COLUMN "embedding_hash" CHAR(64);

-- Cosine-similarity HNSW index backing `ORDER BY embedding <=> $1 LIMIT n`.
CREATE INDEX "document_chunks_embedding_hnsw_idx"
  ON "public"."document_chunks"
  USING hnsw ("embedding" vector_cosine_ops);