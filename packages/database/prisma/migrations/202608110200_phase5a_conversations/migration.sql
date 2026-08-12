-- Phase 5A: conversational answers (WEB channel) — async metadata on messages
-- and AIUsage linkage. `conversations`/`conversation_messages` were created by
-- the Phase 1 migration for the (future) WhatsApp scaffold; this migration
-- extends the existing tables only — no prior migration is edited.
--
-- `status` drives the web polling model: the API creates an ASSISTANT row with
-- status=PENDING, the worker flips it to COMPLETED/FAILED with the answer,
-- sources, versions and measured usage. `input_hash` (shared by the USER
-- question and its ASSISTANT answer) makes a double submit fail-fast through a
-- partial unique index per (conversation, role, hash). AIUsage gains an
-- optional link to the conversation message so web answers persist their
-- provider/model/token counts/latency independently of document analyses.

CREATE TYPE "public"."ConversationMessageStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

ALTER TABLE "public"."conversation_messages"
  ADD COLUMN "status" "public"."ConversationMessageStatus",
  ADD COLUMN "provider" VARCHAR(100),
  ADD COLUMN "model" VARCHAR(200),
  ADD COLUMN "answer_version" VARCHAR(64),
  ADD COLUMN "embedding_version" VARCHAR(64),
  ADD COLUMN "input_tokens" INTEGER,
  ADD COLUMN "output_tokens" INTEGER,
  ADD COLUMN "latency_ms" INTEGER,
  ADD COLUMN "failure_reason" TEXT,
  ADD COLUMN "input_hash" CHAR(64);

CREATE UNIQUE INDEX "conversation_messages_conversation_id_role_input_hash_key"
  ON "public"."conversation_messages"("conversation_id", "role", "input_hash");

ALTER TABLE "public"."ai_usage"
  ADD COLUMN "conversation_message_id" UUID;

ALTER TABLE "public"."ai_usage"
  ADD CONSTRAINT "ai_usage_conversation_message_id_fkey"
  FOREIGN KEY ("conversation_message_id")
  REFERENCES "public"."conversation_messages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ai_usage_conversation_message_id_idx"
  ON "public"."ai_usage"("conversation_message_id");