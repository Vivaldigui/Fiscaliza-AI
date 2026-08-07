-- PostgreSQL requires newly added enum values to be committed before use.
-- This migration intentionally contains only enum changes; columns follow in the next migration.
ALTER TYPE "public"."ProcessingStatus" ADD VALUE IF NOT EXISTS 'RECEIVED' BEFORE 'UPLOADED';
ALTER TYPE "public"."ProcessingStatus" ADD VALUE IF NOT EXISTS 'QUARANTINED' BEFORE 'UPLOADED';
ALTER TYPE "public"."ProcessingStatus" ADD VALUE IF NOT EXISTS 'SECURITY_SCAN' BEFORE 'EXTRACTING';
ALTER TYPE "public"."ProcessingStatus" ADD VALUE IF NOT EXISTS 'CHUNKING' AFTER 'OCR';
ALTER TYPE "public"."OcrStatus" ADD VALUE IF NOT EXISTS 'SKIPPED' AFTER 'NOT_REQUIRED';

CREATE TYPE "public"."DocumentSecurityStatus" AS ENUM (
  'PENDING',
  'SCANNING',
  'CLEAN',
  'INFECTED',
  'SKIPPED',
  'FAILED'
);

CREATE TYPE "public"."DocumentIngestionSource" AS ENUM ('UPLOAD', 'INBOX');
CREATE TYPE "public"."DocumentTextSource" AS ENUM ('EXTRACTED', 'OCR', 'EMPTY');
CREATE TYPE "public"."DocumentProcessingTrigger" AS ENUM ('UPLOAD', 'INBOX', 'REPROCESS');
CREATE TYPE "public"."DocumentAttemptStatus" AS ENUM (
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'NEEDS_REVIEW',
  'FAILED'
);
