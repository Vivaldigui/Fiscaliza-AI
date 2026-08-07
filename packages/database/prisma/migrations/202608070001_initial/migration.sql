-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "public"."RoleCode" AS ENUM ('ADMIN', 'SECRETARIAT', 'COUNCILOR', 'AUDITOR');

-- CreateEnum
CREATE TYPE "public"."PropositionType" AS ENUM ('REQUEST', 'INDICATION');

-- CreateEnum
CREATE TYPE "public"."PropositionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'AWAITING_RESPONSE', 'PARTIALLY_RESPONDED', 'RESPONDED', 'ARCHIVED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "public"."ProcessingStatus" AS ENUM ('UPLOADED', 'EXTRACTING', 'OCR', 'CLASSIFYING', 'ASSOCIATING', 'ANALYZING', 'COMPLETED', 'NEEDS_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."TextExtractionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."OcrStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."DocumentKind" AS ENUM ('PROPOSITION', 'RESPONSE', 'EXTENSION', 'ATTACHMENT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "public"."AccessLevel" AS ENUM ('INTERNAL', 'RESTRICTED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "public"."DocumentLinkRole" AS ENUM ('PRIMARY', 'ATTACHMENT', 'SUPPORTING');

-- CreateEnum
CREATE TYPE "public"."ExpectedAnswerType" AS ENUM ('TEXT', 'QUANTITY', 'CURRENCY', 'DATE', 'LIST', 'BOOLEAN', 'DOCUMENT', 'ACTION', 'MIXED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "public"."ResponseType" AS ENUM ('INITIAL', 'COMPLEMENTARY', 'RECTIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."ResponseStatus" AS ENUM ('INGESTED', 'NEEDS_REVIEW', 'ASSOCIATED', 'PROCESSING', 'ANALYZED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."AssociationMethod" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."AnalysisType" AS ENUM ('REQUEST_EXTRACTION', 'REQUEST_RESPONSE', 'INDICATION_EXTRACTION', 'INDICATION_RESPONSE', 'EXECUTIVE_SUMMARY', 'CONVERSATION_ANSWER');

-- CreateEnum
CREATE TYPE "public"."AnalysisStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'NEEDS_HUMAN_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."AnalysisItemStatus" AS ENUM ('ANSWERED', 'PARTIALLY_ANSWERED', 'NOT_ANSWERED', 'INCONCLUSIVE', 'NOT_APPLICABLE', 'ACCEPTED', 'REJECTED', 'UNDER_ANALYSIS', 'ACTION_REPORTED', 'EXECUTION_REPORTED', 'NO_CLEAR_POSITION', 'NEEDS_HUMAN_REVIEW');

-- CreateEnum
CREATE TYPE "public"."EvidenceKind" AS ENUM ('TEXT', 'VISUAL_REFERENCE');

-- CreateEnum
CREATE TYPE "public"."DeadlineStatus" AS ENUM ('OPEN', 'DUE_SOON', 'OVERDUE', 'RESPONDED', 'EXTENDED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "public"."CountingMode" AS ENUM ('CALENDAR_DAYS', 'BUSINESS_DAYS');

-- CreateEnum
CREATE TYPE "public"."ConversationChannel" AS ENUM ('WEB', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "public"."MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM_EVENT');

-- CreateEnum
CREATE TYPE "public"."InboundMessageStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'COMPLETED', 'DENIED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."NotificationChannel" AS ENUM ('WEB', 'WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "public"."NotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."SettingValueType" AS ENUM ('STRING', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'JSON');

-- CreateEnum
CREATE TYPE "public"."OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "status" "public"."UserStatus" NOT NULL DEFAULT 'INVITED',
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."roles" (
    "id" UUID NOT NULL,
    "code" "public"."RoleCode" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "public"."refresh_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "user_agent" VARCHAR(500),
    "ip_address" VARCHAR(64),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."councilors" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "display_name" VARCHAR(200) NOT NULL,
    "legal_name" VARCHAR(200),
    "party" VARCHAR(50),
    "term_start" DATE,
    "term_end" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "councilors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."whatsapp_identities" (
    "id" UUID NOT NULL,
    "councilor_id" UUID NOT NULL,
    "phone_number" VARCHAR(20) NOT NULL,
    "instance" VARCHAR(100) NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."propositions" (
    "id" UUID NOT NULL,
    "type" "public"."PropositionType" NOT NULL,
    "number" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "protocol_number" VARCHAR(100),
    "protocol_date" DATE,
    "author_id" UUID NOT NULL,
    "recipient" VARCHAR(300),
    "subject" VARCHAR(500) NOT NULL,
    "summary" TEXT,
    "status" "public"."PropositionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "propositions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."requested_items" (
    "id" UUID NOT NULL,
    "proposition_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "original_text" TEXT NOT NULL,
    "normalized_question" TEXT NOT NULL,
    "category" VARCHAR(100),
    "expected_answer_type" "public"."ExpectedAnswerType" NOT NULL DEFAULT 'UNKNOWN',
    "source_page" INTEGER,
    "extraction_confidence" DECIMAL(4,3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "requested_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."documents" (
    "id" UUID NOT NULL,
    "original_name" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(150) NOT NULL,
    "storage_key" VARCHAR(1024) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "page_count" INTEGER,
    "kind" "public"."DocumentKind" NOT NULL DEFAULT 'UNKNOWN',
    "access_level" "public"."AccessLevel" NOT NULL DEFAULT 'INTERNAL',
    "processing_status" "public"."ProcessingStatus" NOT NULL DEFAULT 'UPLOADED',
    "text_extraction_status" "public"."TextExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "ocr_status" "public"."OcrStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "extracted_text" TEXT,
    "ocr_text" TEXT,
    "extraction_confidence" DECIMAL(4,3),
    "processing_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_pages" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "page_number" INTEGER NOT NULL,
    "extracted_text" TEXT,
    "ocr_text" TEXT,
    "effective_text" TEXT NOT NULL DEFAULT '',
    "extraction_confidence" DECIMAL(4,3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."document_chunks" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "page_number" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."proposition_documents" (
    "proposition_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "role" "public"."DocumentLinkRole" NOT NULL DEFAULT 'ATTACHMENT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposition_documents_pkey" PRIMARY KEY ("proposition_id","document_id")
);

-- CreateTable
CREATE TABLE "public"."responses" (
    "id" UUID NOT NULL,
    "proposition_id" UUID,
    "type" "public"."ResponseType" NOT NULL DEFAULT 'INITIAL',
    "protocol_number" VARCHAR(100),
    "protocol_date" DATE,
    "sender" VARCHAR(300),
    "subject" VARCHAR(500),
    "status" "public"."ResponseStatus" NOT NULL DEFAULT 'INGESTED',
    "association_method" "public"."AssociationMethod",
    "association_confidence" DECIMAL(4,3),
    "associated_by_id" UUID,
    "associated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."response_documents" (
    "response_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "role" "public"."DocumentLinkRole" NOT NULL DEFAULT 'PRIMARY',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "response_documents_pkey" PRIMARY KEY ("response_id","document_id")
);

-- CreateTable
CREATE TABLE "public"."response_extensions" (
    "id" UUID NOT NULL,
    "response_id" UUID NOT NULL,
    "document_id" UUID,
    "requested_at" DATE NOT NULL,
    "requested_due_date" DATE,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "response_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."association_candidates" (
    "id" UUID NOT NULL,
    "response_id" UUID NOT NULL,
    "proposition_id" UUID NOT NULL,
    "score" DECIMAL(4,3) NOT NULL,
    "signal_scores" JSONB NOT NULL,
    "rank" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "association_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."analyses" (
    "id" UUID NOT NULL,
    "proposition_id" UUID NOT NULL,
    "response_id" UUID,
    "type" "public"."AnalysisType" NOT NULL,
    "status" "public"."AnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "confidence" DECIMAL(4,3),
    "executive_summary" JSONB,
    "original_result" JSONB,
    "current_result" JSONB,
    "provider" VARCHAR(100) NOT NULL,
    "model" VARCHAR(200) NOT NULL,
    "prompt_version" VARCHAR(100) NOT NULL,
    "analysis_version" VARCHAR(100) NOT NULL,
    "input_hash" CHAR(64) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."analysis_documents" (
    "analysis_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_documents_pkey" PRIMARY KEY ("analysis_id","document_id")
);

-- CreateTable
CREATE TABLE "public"."analysis_items" (
    "id" UUID NOT NULL,
    "analysis_id" UUID NOT NULL,
    "requested_item_id" UUID,
    "original_status" "public"."AnalysisItemStatus" NOT NULL,
    "current_status" "public"."AnalysisItemStatus" NOT NULL,
    "original_explanation" TEXT NOT NULL,
    "current_explanation" TEXT NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "analysis_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."evidences" (
    "id" UUID NOT NULL,
    "analysis_id" UUID NOT NULL,
    "analysis_item_id" UUID,
    "document_id" UUID NOT NULL,
    "page_number" INTEGER NOT NULL,
    "kind" "public"."EvidenceKind" NOT NULL DEFAULT 'TEXT',
    "excerpt" TEXT,
    "reason" TEXT NOT NULL,
    "start_offset" INTEGER,
    "end_offset" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."analysis_revisions" (
    "id" UUID NOT NULL,
    "analysis_item_id" UUID NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "previous_status" "public"."AnalysisItemStatus" NOT NULL,
    "new_status" "public"."AnalysisItemStatus" NOT NULL,
    "previous_explanation" TEXT NOT NULL,
    "new_explanation" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_usage" (
    "id" UUID NOT NULL,
    "analysis_id" UUID,
    "provider" VARCHAR(100) NOT NULL,
    "model" VARCHAR(200) NOT NULL,
    "operation" VARCHAR(100) NOT NULL,
    "prompt_version" VARCHAR(100) NOT NULL,
    "analysis_version" VARCHAR(100) NOT NULL,
    "input_hash" CHAR(64) NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "latency_ms" INTEGER NOT NULL,
    "estimated_cost" DECIMAL(14,6),
    "currency" CHAR(3),
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."deadlines" (
    "id" UUID NOT NULL,
    "proposition_id" UUID NOT NULL,
    "base_date" DATE NOT NULL,
    "original_due_date" DATE NOT NULL,
    "current_due_date" DATE NOT NULL,
    "status" "public"."DeadlineStatus" NOT NULL DEFAULT 'OPEN',
    "counting_mode" "public"."CountingMode" NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "configuration_snapshot" JSONB NOT NULL,
    "responded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deadlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."deadline_extensions" (
    "id" UUID NOT NULL,
    "deadline_id" UUID NOT NULL,
    "previous_due_date" DATE NOT NULL,
    "new_due_date" DATE NOT NULL,
    "extension_days" INTEGER NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deadline_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."deadline_suspensions" (
    "id" UUID NOT NULL,
    "deadline_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "changed_by_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deadline_suspensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."holidays" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "scope" VARCHAR(50) NOT NULL DEFAULT 'MUNICIPAL',
    "timezone" VARCHAR(100) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "proposition_id" UUID,
    "channel" "public"."ConversationChannel" NOT NULL,
    "title" VARCHAR(300),
    "last_interaction_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversation_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "public"."MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "sources" JSONB,
    "external_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inbound_messages" (
    "id" UUID NOT NULL,
    "instance" VARCHAR(100) NOT NULL,
    "message_id" VARCHAR(255) NOT NULL,
    "phone_hash" CHAR(64) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "status" "public"."InboundMessageStatus" NOT NULL DEFAULT 'RECEIVED',
    "response_body" JSONB,
    "error" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "channel" "public"."NotificationChannel" NOT NULL,
    "template" VARCHAR(150) NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "status" "public"."NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "external_message_id" VARCHAR(255),
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."system_settings" (
    "id" UUID NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "value" JSONB NOT NULL,
    "value_type" "public"."SettingValueType" NOT NULL,
    "description" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(150) NOT NULL,
    "resource_type" VARCHAR(150) NOT NULL,
    "resource_id" VARCHAR(100),
    "previous_state" JSONB,
    "new_state" JSONB,
    "metadata" JSONB,
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(500),
    "request_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."outbox_events" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(150) NOT NULL,
    "aggregate_type" VARCHAR(150) NOT NULL,
    "aggregate_id" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "public"."OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."processed_events" (
    "consumer" VARCHAR(150) NOT NULL,
    "event_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("consumer","event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "public"."users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "public"."roles"("code");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "public"."user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "public"."refresh_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_expires_at_idx" ON "public"."refresh_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "councilors_user_id_key" ON "public"."councilors"("user_id");

-- CreateIndex
CREATE INDEX "councilors_active_display_name_idx" ON "public"."councilors"("active", "display_name");

-- CreateIndex
CREATE INDEX "whatsapp_identities_councilor_id_active_idx" ON "public"."whatsapp_identities"("councilor_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_identities_phone_number_instance_key" ON "public"."whatsapp_identities"("phone_number", "instance");

-- CreateIndex
CREATE INDEX "propositions_author_id_year_type_idx" ON "public"."propositions"("author_id", "year", "type");

-- CreateIndex
CREATE INDEX "propositions_status_protocol_date_idx" ON "public"."propositions"("status", "protocol_date");

-- CreateIndex
CREATE INDEX "propositions_protocol_number_idx" ON "public"."propositions"("protocol_number");

-- CreateIndex
CREATE UNIQUE INDEX "propositions_type_number_year_key" ON "public"."propositions"("type", "number", "year");

-- CreateIndex
CREATE INDEX "requested_items_proposition_id_category_idx" ON "public"."requested_items"("proposition_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "requested_items_proposition_id_sequence_key" ON "public"."requested_items"("proposition_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "public"."documents"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "documents_sha256_key" ON "public"."documents"("sha256");

-- CreateIndex
CREATE INDEX "documents_processing_status_created_at_idx" ON "public"."documents"("processing_status", "created_at");

-- CreateIndex
CREATE INDEX "documents_kind_created_at_idx" ON "public"."documents"("kind", "created_at");

-- CreateIndex
CREATE INDEX "document_pages_document_id_page_number_idx" ON "public"."document_pages"("document_id", "page_number");

-- CreateIndex
CREATE UNIQUE INDEX "document_pages_document_id_page_number_key" ON "public"."document_pages"("document_id", "page_number");

-- CreateIndex
CREATE INDEX "document_chunks_document_id_page_number_idx" ON "public"."document_chunks"("document_id", "page_number");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_document_id_page_number_sequence_key" ON "public"."document_chunks"("document_id", "page_number", "sequence");

-- CreateIndex
CREATE INDEX "proposition_documents_document_id_idx" ON "public"."proposition_documents"("document_id");

-- CreateIndex
CREATE INDEX "responses_proposition_id_protocol_date_idx" ON "public"."responses"("proposition_id", "protocol_date");

-- CreateIndex
CREATE INDEX "responses_status_created_at_idx" ON "public"."responses"("status", "created_at");

-- CreateIndex
CREATE INDEX "responses_protocol_number_idx" ON "public"."responses"("protocol_number");

-- CreateIndex
CREATE INDEX "response_documents_document_id_idx" ON "public"."response_documents"("document_id");

-- CreateIndex
CREATE INDEX "response_extensions_response_id_requested_at_idx" ON "public"."response_extensions"("response_id", "requested_at");

-- CreateIndex
CREATE INDEX "association_candidates_response_id_rank_idx" ON "public"."association_candidates"("response_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "association_candidates_response_id_proposition_id_key" ON "public"."association_candidates"("response_id", "proposition_id");

-- CreateIndex
CREATE UNIQUE INDEX "analyses_input_hash_key" ON "public"."analyses"("input_hash");

-- CreateIndex
CREATE INDEX "analyses_proposition_id_type_created_at_idx" ON "public"."analyses"("proposition_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "analyses_response_id_idx" ON "public"."analyses"("response_id");

-- CreateIndex
CREATE INDEX "analyses_status_created_at_idx" ON "public"."analyses"("status", "created_at");

-- CreateIndex
CREATE INDEX "analysis_documents_document_id_idx" ON "public"."analysis_documents"("document_id");

-- CreateIndex
CREATE INDEX "analysis_items_analysis_id_current_status_idx" ON "public"."analysis_items"("analysis_id", "current_status");

-- CreateIndex
CREATE INDEX "analysis_items_requested_item_id_idx" ON "public"."analysis_items"("requested_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_items_analysis_id_requested_item_id_key" ON "public"."analysis_items"("analysis_id", "requested_item_id");

-- CreateIndex
CREATE INDEX "evidences_analysis_id_idx" ON "public"."evidences"("analysis_id");

-- CreateIndex
CREATE INDEX "evidences_analysis_item_id_idx" ON "public"."evidences"("analysis_item_id");

-- CreateIndex
CREATE INDEX "evidences_document_id_page_number_idx" ON "public"."evidences"("document_id", "page_number");

-- CreateIndex
CREATE INDEX "analysis_revisions_analysis_item_id_created_at_idx" ON "public"."analysis_revisions"("analysis_item_id", "created_at");

-- CreateIndex
CREATE INDEX "analysis_revisions_changed_by_id_created_at_idx" ON "public"."analysis_revisions"("changed_by_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_analysis_id_idx" ON "public"."ai_usage"("analysis_id");

-- CreateIndex
CREATE INDEX "ai_usage_provider_model_created_at_idx" ON "public"."ai_usage"("provider", "model", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_input_hash_idx" ON "public"."ai_usage"("input_hash");

-- CreateIndex
CREATE UNIQUE INDEX "deadlines_proposition_id_key" ON "public"."deadlines"("proposition_id");

-- CreateIndex
CREATE INDEX "deadlines_status_current_due_date_idx" ON "public"."deadlines"("status", "current_due_date");

-- CreateIndex
CREATE INDEX "deadline_extensions_deadline_id_granted_at_idx" ON "public"."deadline_extensions"("deadline_id", "granted_at");

-- CreateIndex
CREATE INDEX "deadline_suspensions_deadline_id_started_at_idx" ON "public"."deadline_suspensions"("deadline_id", "started_at");

-- CreateIndex
CREATE INDEX "holidays_active_date_idx" ON "public"."holidays"("active", "date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_scope_key" ON "public"."holidays"("date", "scope");

-- CreateIndex
CREATE INDEX "conversations_user_id_last_interaction_at_idx" ON "public"."conversations"("user_id", "last_interaction_at");

-- CreateIndex
CREATE INDEX "conversations_proposition_id_idx" ON "public"."conversations"("proposition_id");

-- CreateIndex
CREATE INDEX "conversation_messages_conversation_id_created_at_idx" ON "public"."conversation_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_messages_external_id_idx" ON "public"."conversation_messages"("external_id");

-- CreateIndex
CREATE INDEX "inbound_messages_status_received_at_idx" ON "public"."inbound_messages"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_messages_instance_message_id_key" ON "public"."inbound_messages"("instance", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_idempotency_key_key" ON "public"."notifications"("idempotency_key");

-- CreateIndex
CREATE INDEX "notifications_status_next_attempt_at_idx" ON "public"."notifications"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notifications_recipient_id_created_at_idx" ON "public"."notifications"("recipient_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "public"."system_settings"("key");

-- CreateIndex
CREATE INDEX "system_settings_updated_at_idx" ON "public"."system_settings"("updated_at");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_created_at_idx" ON "public"."audit_logs"("resource_type", "resource_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "public"."audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_request_id_idx" ON "public"."audit_logs"("request_id");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "public"."outbox_events"("status", "available_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_idx" ON "public"."outbox_events"("aggregate_type", "aggregate_id");

-- AddForeignKey
ALTER TABLE "public"."user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."councilors" ADD CONSTRAINT "councilors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."whatsapp_identities" ADD CONSTRAINT "whatsapp_identities_councilor_id_fkey" FOREIGN KEY ("councilor_id") REFERENCES "public"."councilors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."propositions" ADD CONSTRAINT "propositions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."councilors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."requested_items" ADD CONSTRAINT "requested_items_proposition_id_fkey" FOREIGN KEY ("proposition_id") REFERENCES "public"."propositions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_pages" ADD CONSTRAINT "document_pages_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."document_chunks" ADD CONSTRAINT "document_chunks_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."document_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."proposition_documents" ADD CONSTRAINT "proposition_documents_proposition_id_fkey" FOREIGN KEY ("proposition_id") REFERENCES "public"."propositions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."proposition_documents" ADD CONSTRAINT "proposition_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."responses" ADD CONSTRAINT "responses_proposition_id_fkey" FOREIGN KEY ("proposition_id") REFERENCES "public"."propositions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."responses" ADD CONSTRAINT "responses_associated_by_id_fkey" FOREIGN KEY ("associated_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."response_documents" ADD CONSTRAINT "response_documents_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."response_documents" ADD CONSTRAINT "response_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."response_extensions" ADD CONSTRAINT "response_extensions_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."response_extensions" ADD CONSTRAINT "response_extensions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."association_candidates" ADD CONSTRAINT "association_candidates_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."association_candidates" ADD CONSTRAINT "association_candidates_proposition_id_fkey" FOREIGN KEY ("proposition_id") REFERENCES "public"."propositions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."analyses" ADD CONSTRAINT "analyses_proposition_id_fkey" FOREIGN KEY ("proposition_id") REFERENCES "public"."propositions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."analyses" ADD CONSTRAINT "analyses_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."analysis_documents" ADD CONSTRAINT "analysis_documents_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."analysis_documents" ADD CONSTRAINT "analysis_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."analysis_items" ADD CONSTRAINT "analysis_items_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."analysis_items" ADD CONSTRAINT "analysis_items_requested_item_id_fkey" FOREIGN KEY ("requested_item_id") REFERENCES "public"."requested_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."analysis_items" ADD CONSTRAINT "analysis_items_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."evidences" ADD CONSTRAINT "evidences_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."evidences" ADD CONSTRAINT "evidences_analysis_item_id_fkey" FOREIGN KEY ("analysis_item_id") REFERENCES "public"."analysis_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."evidences" ADD CONSTRAINT "evidences_document_id_page_number_fkey" FOREIGN KEY ("document_id", "page_number") REFERENCES "public"."document_pages"("document_id", "page_number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."analysis_revisions" ADD CONSTRAINT "analysis_revisions_analysis_item_id_fkey" FOREIGN KEY ("analysis_item_id") REFERENCES "public"."analysis_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."analysis_revisions" ADD CONSTRAINT "analysis_revisions_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain integrity constraints not expressible in Prisma Schema Language.
ALTER TABLE "public"."requested_items"
  ADD CONSTRAINT "requested_items_sequence_positive" CHECK ("sequence" >= 1),
  ADD CONSTRAINT "requested_items_source_page_positive" CHECK ("source_page" IS NULL OR "source_page" >= 1),
  ADD CONSTRAINT "requested_items_extraction_confidence_range" CHECK ("extraction_confidence" IS NULL OR ("extraction_confidence" >= 0 AND "extraction_confidence" <= 1));

ALTER TABLE "public"."documents"
  ADD CONSTRAINT "documents_size_positive" CHECK ("size_bytes" > 0),
  ADD CONSTRAINT "documents_page_count_positive" CHECK ("page_count" IS NULL OR "page_count" >= 1),
  ADD CONSTRAINT "documents_extraction_confidence_range" CHECK ("extraction_confidence" IS NULL OR ("extraction_confidence" >= 0 AND "extraction_confidence" <= 1));

ALTER TABLE "public"."document_pages"
  ADD CONSTRAINT "document_pages_page_number_positive" CHECK ("page_number" >= 1),
  ADD CONSTRAINT "document_pages_extraction_confidence_range" CHECK ("extraction_confidence" IS NULL OR ("extraction_confidence" >= 0 AND "extraction_confidence" <= 1));

ALTER TABLE "public"."document_chunks"
  ADD CONSTRAINT "document_chunks_page_number_positive" CHECK ("page_number" >= 1),
  ADD CONSTRAINT "document_chunks_sequence_nonnegative" CHECK ("sequence" >= 0);

ALTER TABLE "public"."responses"
  ADD CONSTRAINT "responses_association_confidence_range" CHECK ("association_confidence" IS NULL OR ("association_confidence" >= 0 AND "association_confidence" <= 1));

ALTER TABLE "public"."association_candidates"
  ADD CONSTRAINT "association_candidates_score_range" CHECK ("score" >= 0 AND "score" <= 1),
  ADD CONSTRAINT "association_candidates_rank_positive" CHECK ("rank" >= 1);

ALTER TABLE "public"."analyses"
  ADD CONSTRAINT "analyses_confidence_range" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

ALTER TABLE "public"."analysis_items"
  ADD CONSTRAINT "analysis_items_confidence_range" CHECK ("confidence" >= 0 AND "confidence" <= 1);

ALTER TABLE "public"."evidences"
  ADD CONSTRAINT "evidences_page_number_positive" CHECK ("page_number" >= 1),
  ADD CONSTRAINT "evidences_offsets_valid" CHECK (("start_offset" IS NULL AND "end_offset" IS NULL) OR ("start_offset" >= 0 AND "end_offset" >= "start_offset"));

ALTER TABLE "public"."ai_usage"
  ADD CONSTRAINT "ai_usage_tokens_nonnegative" CHECK (("input_tokens" IS NULL OR "input_tokens" >= 0) AND ("output_tokens" IS NULL OR "output_tokens" >= 0)),
  ADD CONSTRAINT "ai_usage_latency_nonnegative" CHECK ("latency_ms" >= 0),
  ADD CONSTRAINT "ai_usage_cost_nonnegative" CHECK ("estimated_cost" IS NULL OR "estimated_cost" >= 0);

ALTER TABLE "public"."deadline_extensions"
  ADD CONSTRAINT "deadline_extensions_days_nonnegative" CHECK ("extension_days" >= 0),
  ADD CONSTRAINT "deadline_extensions_dates_ordered" CHECK ("new_due_date" >= "previous_due_date");

ALTER TABLE "public"."deadline_suspensions"
  ADD CONSTRAINT "deadline_suspensions_dates_ordered" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at");

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_attempts_nonnegative" CHECK ("attempts" >= 0);

ALTER TABLE "public"."system_settings"
  ADD CONSTRAINT "system_settings_version_positive" CHECK ("version" >= 1);

ALTER TABLE "public"."outbox_events"
  ADD CONSTRAINT "outbox_events_attempts_nonnegative" CHECK ("attempts" >= 0);

-- AddForeignKey
ALTER TABLE "public"."ai_usage" ADD CONSTRAINT "ai_usage_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deadlines" ADD CONSTRAINT "deadlines_proposition_id_fkey" FOREIGN KEY ("proposition_id") REFERENCES "public"."propositions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deadline_extensions" ADD CONSTRAINT "deadline_extensions_deadline_id_fkey" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadlines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deadline_extensions" ADD CONSTRAINT "deadline_extensions_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deadline_suspensions" ADD CONSTRAINT "deadline_suspensions_deadline_id_fkey" FOREIGN KEY ("deadline_id") REFERENCES "public"."deadlines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deadline_suspensions" ADD CONSTRAINT "deadline_suspensions_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_proposition_id_fkey" FOREIGN KEY ("proposition_id") REFERENCES "public"."propositions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."system_settings" ADD CONSTRAINT "system_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
