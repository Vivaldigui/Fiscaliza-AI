ALTER TABLE "public"."documents"
  ADD COLUMN "ingestion_source" "public"."DocumentIngestionSource" NOT NULL DEFAULT 'UPLOAD',
  ADD COLUMN "uploaded_by_id" UUID,
  ADD COLUMN "security_status" "public"."DocumentSecurityStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "last_error_code" VARCHAR(100),
  ADD COLUMN "last_error_at" TIMESTAMPTZ(3),
  ADD COLUMN "processing_attempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "review_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "quarantined_at" TIMESTAMPTZ(3),
  ADD COLUMN "security_scanned_at" TIMESTAMPTZ(3),
  ADD COLUMN "processing_started_at" TIMESTAMPTZ(3),
  ADD COLUMN "processing_completed_at" TIMESTAMPTZ(3);

ALTER TABLE "public"."documents"
  ALTER COLUMN "processing_status" SET DEFAULT 'RECEIVED';

ALTER TABLE "public"."document_pages"
  ADD COLUMN "quality_score" DECIMAL(4,3),
  ADD COLUMN "character_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "requires_ocr" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "quality_reason" VARCHAR(500),
  ADD COLUMN "ocr_status" "public"."OcrStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "ocr_confidence" DECIMAL(4,3),
  ADD COLUMN "effective_text_source" "public"."DocumentTextSource" NOT NULL DEFAULT 'EMPTY';

CREATE TABLE "public"."document_processing_attempts" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "attempt" INTEGER NOT NULL,
  "trigger" "public"."DocumentProcessingTrigger" NOT NULL,
  "status" "public"."DocumentAttemptStatus" NOT NULL DEFAULT 'QUEUED',
  "requested_by_id" UUID,
  "error_code" VARCHAR(100),
  "error_message" TEXT,
  "started_at" TIMESTAMPTZ(3),
  "finished_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "document_processing_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_processing_attempts_document_id_attempt_key"
  ON "public"."document_processing_attempts"("document_id", "attempt");
CREATE INDEX "document_processing_attempts_status_created_at_idx"
  ON "public"."document_processing_attempts"("status", "created_at");
CREATE INDEX "document_processing_attempts_requested_by_id_created_at_idx"
  ON "public"."document_processing_attempts"("requested_by_id", "created_at");
CREATE INDEX "documents_security_status_created_at_idx"
  ON "public"."documents"("security_status", "created_at");
CREATE INDEX "documents_review_required_created_at_idx"
  ON "public"."documents"("review_required", "created_at");
CREATE INDEX "documents_uploaded_by_id_created_at_idx"
  ON "public"."documents"("uploaded_by_id", "created_at");

ALTER TABLE "public"."documents"
  ADD CONSTRAINT "documents_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."document_processing_attempts"
  ADD CONSTRAINT "document_processing_attempts_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."document_processing_attempts"
  ADD CONSTRAINT "document_processing_attempts_requested_by_id_fkey"
  FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."documents"
  ADD CONSTRAINT "documents_processing_attempt_nonnegative"
  CHECK ("processing_attempt" >= 0);

ALTER TABLE "public"."document_pages"
  ADD CONSTRAINT "document_pages_character_count_nonnegative"
    CHECK ("character_count" >= 0),
  ADD CONSTRAINT "document_pages_quality_score_range"
    CHECK ("quality_score" IS NULL OR ("quality_score" >= 0 AND "quality_score" <= 1)),
  ADD CONSTRAINT "document_pages_ocr_confidence_range"
    CHECK ("ocr_confidence" IS NULL OR ("ocr_confidence" >= 0 AND "ocr_confidence" <= 1));

ALTER TABLE "public"."document_processing_attempts"
  ADD CONSTRAINT "document_processing_attempts_attempt_positive"
  CHECK ("attempt" >= 1);
