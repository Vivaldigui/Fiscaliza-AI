-- Phase 3: structured legislative tracking and immutable document derivatives.

CREATE TYPE "public"."PropositionAuthorRole" AS ENUM ('PRIMARY', 'COAUTHOR');
CREATE TYPE "public"."AssociationCandidateStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED');
CREATE TYPE "public"."AssociationEvaluationStatus" AS ENUM ('EVALUATED', 'AUTO_ASSOCIATED', 'NEEDS_REVIEW', 'MANUALLY_RESOLVED');
CREATE TYPE "public"."HolidayScope" AS ENUM ('NATIONAL', 'STATE', 'MUNICIPAL', 'INSTITUTIONAL');
CREATE TYPE "public"."DeadlineExtensionRequestStatus" AS ENUM ('RECEIVED', 'GRANTED', 'REJECTED', 'WITHDRAWN');

ALTER TYPE "public"."DeadlineStatus" ADD VALUE 'RESPONSE_RECEIVED';
ALTER TYPE "public"."PropositionStatus" ADD VALUE 'RESPONSE_RECEIVED';

-- Co-authorship becomes the source of truth. Existing single authors are preserved.
CREATE TABLE "public"."proposition_authors" (
  "proposition_id" UUID NOT NULL,
  "councilor_id" UUID NOT NULL,
  "role" "public"."PropositionAuthorRole" NOT NULL DEFAULT 'COAUTHOR',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposition_authors_pkey" PRIMARY KEY ("proposition_id", "councilor_id")
);

INSERT INTO "public"."proposition_authors" ("proposition_id", "councilor_id", "role")
SELECT "id", "author_id", 'PRIMARY'::"public"."PropositionAuthorRole"
FROM "public"."propositions";

ALTER TABLE "public"."propositions" DROP CONSTRAINT "propositions_author_id_fkey";
DROP INDEX "public"."propositions_author_id_year_type_idx";
ALTER TABLE "public"."propositions" DROP COLUMN "author_id";

CREATE INDEX "proposition_authors_councilor_id_proposition_id_idx"
  ON "public"."proposition_authors" ("councilor_id", "proposition_id");
CREATE INDEX "proposition_authors_proposition_id_role_idx"
  ON "public"."proposition_authors" ("proposition_id", "role");
CREATE UNIQUE INDEX "proposition_authors_one_primary_idx"
  ON "public"."proposition_authors" ("proposition_id") WHERE "role" = 'PRIMARY';
CREATE INDEX "propositions_year_type_idx" ON "public"."propositions" ("year", "type");
CREATE INDEX "propositions_subject_idx" ON "public"."propositions" ("subject");

ALTER TABLE "public"."proposition_authors"
  ADD CONSTRAINT "proposition_authors_proposition_id_fkey"
  FOREIGN KEY ("proposition_id") REFERENCES "public"."propositions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "proposition_authors_councilor_id_fkey"
  FOREIGN KEY ("councilor_id") REFERENCES "public"."councilors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve the original, semantically ambiguous table as explicitly legacy data.
ALTER TABLE "public"."response_extensions" RENAME TO "legacy_response_extensions";
ALTER TABLE "public"."legacy_response_extensions"
  RENAME CONSTRAINT "response_extensions_pkey" TO "legacy_response_extensions_pkey";
ALTER TABLE "public"."legacy_response_extensions"
  RENAME CONSTRAINT "response_extensions_response_id_fkey" TO "legacy_response_extensions_response_id_fkey";
ALTER TABLE "public"."legacy_response_extensions"
  RENAME CONSTRAINT "response_extensions_document_id_fkey" TO "legacy_response_extensions_document_id_fkey";
ALTER INDEX "public"."response_extensions_response_id_requested_at_idx"
  RENAME TO "legacy_response_extensions_response_id_requested_at_idx";

-- Processing attempts now own immutable page/chunk versions.
INSERT INTO "public"."document_processing_attempts" (
  "id", "document_id", "attempt", "trigger", "status", "requested_by_id", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  d."id",
  d."processing_attempt",
  CASE d."ingestion_source"
    WHEN 'INBOX' THEN 'INBOX'::"public"."DocumentProcessingTrigger"
    ELSE 'UPLOAD'::"public"."DocumentProcessingTrigger"
  END,
  CASE d."processing_status"
    WHEN 'COMPLETED' THEN 'COMPLETED'::"public"."DocumentAttemptStatus"
    WHEN 'NEEDS_REVIEW' THEN 'NEEDS_REVIEW'::"public"."DocumentAttemptStatus"
    WHEN 'FAILED' THEN 'FAILED'::"public"."DocumentAttemptStatus"
    ELSE 'QUEUED'::"public"."DocumentAttemptStatus"
  END,
  d."uploaded_by_id",
  d."created_at",
  d."updated_at"
FROM "public"."documents" d
WHERE NOT EXISTS (
  SELECT 1 FROM "public"."document_processing_attempts" a
  WHERE a."document_id" = d."id" AND a."attempt" = d."processing_attempt"
);

ALTER TABLE "public"."document_pages" ADD COLUMN "processing_attempt_id" UUID;
ALTER TABLE "public"."document_chunks" ADD COLUMN "processing_attempt_id" UUID;
ALTER TABLE "public"."analysis_documents" ADD COLUMN "processing_attempt_id" UUID;
ALTER TABLE "public"."evidences" ADD COLUMN "document_page_id" UUID;

UPDATE "public"."document_pages" p
SET "processing_attempt_id" = a."id"
FROM "public"."documents" d
JOIN "public"."document_processing_attempts" a
  ON a."document_id" = d."id" AND a."attempt" = d."processing_attempt"
WHERE p."document_id" = d."id";

UPDATE "public"."document_chunks" c
SET "processing_attempt_id" = p."processing_attempt_id"
FROM "public"."document_pages" p
WHERE c."page_id" = p."id";

UPDATE "public"."analysis_documents" ad
SET "processing_attempt_id" = a."id"
FROM "public"."documents" d
JOIN "public"."document_processing_attempts" a
  ON a."document_id" = d."id" AND a."attempt" = d."processing_attempt"
WHERE ad."document_id" = d."id";

UPDATE "public"."evidences" e
SET "document_page_id" = p."id"
FROM "public"."document_pages" p
WHERE p."document_id" = e."document_id" AND p."page_number" = e."page_number";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "public"."document_pages" WHERE "processing_attempt_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "public"."document_chunks" WHERE "processing_attempt_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "public"."analysis_documents" WHERE "processing_attempt_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "public"."evidences" WHERE "document_page_id" IS NULL) THEN
    RAISE EXCEPTION 'Backfill de versionamento documental incompleto';
  END IF;
END $$;

ALTER TABLE "public"."document_pages" ALTER COLUMN "processing_attempt_id" SET NOT NULL;
ALTER TABLE "public"."document_chunks" ALTER COLUMN "processing_attempt_id" SET NOT NULL;
ALTER TABLE "public"."analysis_documents" ALTER COLUMN "processing_attempt_id" SET NOT NULL;
ALTER TABLE "public"."evidences" ALTER COLUMN "document_page_id" SET NOT NULL;

ALTER TABLE "public"."evidences" DROP CONSTRAINT "evidences_document_id_page_number_fkey";
DROP INDEX "public"."document_pages_document_id_page_number_key";
DROP INDEX "public"."document_chunks_document_id_page_number_sequence_key";

CREATE UNIQUE INDEX "document_pages_processing_attempt_id_page_number_key"
  ON "public"."document_pages" ("processing_attempt_id", "page_number");
CREATE INDEX "document_pages_document_id_processing_attempt_id_page_numbe_idx"
  ON "public"."document_pages" ("document_id", "processing_attempt_id", "page_number");
CREATE UNIQUE INDEX "document_chunks_processing_attempt_id_page_number_sequence_key"
  ON "public"."document_chunks" ("processing_attempt_id", "page_number", "sequence");
CREATE INDEX "document_chunks_document_id_processing_attempt_id_page_numb_idx"
  ON "public"."document_chunks" ("document_id", "processing_attempt_id", "page_number");
CREATE INDEX "analysis_documents_processing_attempt_id_idx"
  ON "public"."analysis_documents" ("processing_attempt_id");
CREATE INDEX "evidences_document_page_id_idx" ON "public"."evidences" ("document_page_id");

ALTER TABLE "public"."document_pages"
  ADD CONSTRAINT "document_pages_processing_attempt_id_fkey"
  FOREIGN KEY ("processing_attempt_id") REFERENCES "public"."document_processing_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."document_chunks"
  ADD CONSTRAINT "document_chunks_processing_attempt_id_fkey"
  FOREIGN KEY ("processing_attempt_id") REFERENCES "public"."document_processing_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."analysis_documents"
  ADD CONSTRAINT "analysis_documents_processing_attempt_id_fkey"
  FOREIGN KEY ("processing_attempt_id") REFERENCES "public"."document_processing_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."evidences"
  ADD CONSTRAINT "evidences_document_page_id_fkey"
  FOREIGN KEY ("document_page_id") REFERENCES "public"."document_pages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Deterministic, explainable association evaluations and immutable correction history.
CREATE TABLE "public"."association_evaluations" (
  "id" UUID NOT NULL,
  "response_id" UUID NOT NULL,
  "status" "public"."AssociationEvaluationStatus" NOT NULL DEFAULT 'EVALUATED',
  "top_score" DECIMAL(4,3),
  "second_score" DECIMAL(4,3),
  "margin" DECIMAL(4,3),
  "configuration_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "association_evaluations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."association_candidates"
  ADD COLUMN "evaluation_id" UUID,
  ADD COLUMN "status" "public"."AssociationCandidateStatus" NOT NULL DEFAULT 'PENDING';

INSERT INTO "public"."association_evaluations" (
  "id", "response_id", "status", "top_score", "second_score", "margin", "configuration_snapshot"
)
SELECT
  gen_random_uuid(),
  c."response_id",
  'NEEDS_REVIEW'::"public"."AssociationEvaluationStatus",
  MAX(c."score"),
  (ARRAY_AGG(c."score" ORDER BY c."score" DESC))[2],
  MAX(c."score") - COALESCE((ARRAY_AGG(c."score" ORDER BY c."score" DESC))[2], 0),
  '{"migration":"phase3"}'::jsonb
FROM "public"."association_candidates" c
GROUP BY c."response_id";

UPDATE "public"."association_candidates" c
SET "evaluation_id" = e."id"
FROM "public"."association_evaluations" e
WHERE e."response_id" = c."response_id"
  AND e."configuration_snapshot" ->> 'migration' = 'phase3';

ALTER TABLE "public"."association_candidates" ALTER COLUMN "evaluation_id" SET NOT NULL;
DROP INDEX "public"."association_candidates_response_id_proposition_id_key";
CREATE UNIQUE INDEX "association_candidates_evaluation_id_proposition_id_key"
  ON "public"."association_candidates" ("evaluation_id", "proposition_id");
CREATE INDEX "association_candidates_proposition_id_status_idx"
  ON "public"."association_candidates" ("proposition_id", "status");
CREATE INDEX "association_evaluations_response_id_created_at_idx"
  ON "public"."association_evaluations" ("response_id", "created_at");
CREATE INDEX "association_evaluations_status_created_at_idx"
  ON "public"."association_evaluations" ("status", "created_at");

ALTER TABLE "public"."association_evaluations"
  ADD CONSTRAINT "association_evaluations_response_id_fkey"
  FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."association_candidates"
  ADD CONSTRAINT "association_candidates_evaluation_id_fkey"
  FOREIGN KEY ("evaluation_id") REFERENCES "public"."association_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."responses" ADD COLUMN "association_version" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "public"."response_association_revisions" (
  "id" UUID NOT NULL,
  "response_id" UUID NOT NULL,
  "previous_proposition_id" UUID,
  "new_proposition_id" UUID,
  "previous_method" "public"."AssociationMethod",
  "new_method" "public"."AssociationMethod",
  "changed_by_id" UUID,
  "reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "response_association_revisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "response_association_revisions_response_id_created_at_idx"
  ON "public"."response_association_revisions" ("response_id", "created_at");
CREATE INDEX "response_association_revisions_changed_by_id_created_at_idx"
  ON "public"."response_association_revisions" ("changed_by_id", "created_at");
ALTER TABLE "public"."response_association_revisions"
  ADD CONSTRAINT "response_association_revisions_response_id_fkey"
  FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "response_association_revisions_previous_proposition_id_fkey"
  FOREIGN KEY ("previous_proposition_id") REFERENCES "public"."propositions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "response_association_revisions_new_proposition_id_fkey"
  FOREIGN KEY ("new_proposition_id") REFERENCES "public"."propositions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "response_association_revisions_changed_by_id_fkey"
  FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Explicitly separate extension requests/communications from effective due-date changes.
CREATE TABLE "public"."deadline_extension_requests" (
  "id" UUID NOT NULL,
  "proposition_id" UUID NOT NULL,
  "deadline_id" UUID NOT NULL,
  "document_id" UUID,
  "requested_at" DATE NOT NULL,
  "requested_due_date" DATE,
  "requested_days" INTEGER,
  "reason" TEXT,
  "status" "public"."DeadlineExtensionRequestStatus" NOT NULL DEFAULT 'RECEIVED',
  "registered_by_id" UUID NOT NULL,
  "decided_by_id" UUID,
  "decided_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "deadline_extension_requests_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."deadline_extensions" ADD COLUMN "request_id" UUID;
ALTER TABLE "public"."deadline_suspensions"
  ADD COLUMN "resumed_by_id" UUID,
  ADD COLUMN "previous_due_date" DATE,
  ADD COLUMN "new_due_date" DATE;
ALTER TABLE "public"."deadlines" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "deadline_extensions_request_id_key" ON "public"."deadline_extensions" ("request_id");
CREATE INDEX "deadline_extension_requests_proposition_id_requested_at_idx"
  ON "public"."deadline_extension_requests" ("proposition_id", "requested_at");
CREATE INDEX "deadline_extension_requests_deadline_id_status_idx"
  ON "public"."deadline_extension_requests" ("deadline_id", "status");
CREATE INDEX "deadline_extension_requests_document_id_idx"
  ON "public"."deadline_extension_requests" ("document_id");
CREATE UNIQUE INDEX "deadline_suspensions_one_open_idx"
  ON "public"."deadline_suspensions" ("deadline_id") WHERE "ended_at" IS NULL;

ALTER TABLE "public"."deadline_extension_requests"
  ADD CONSTRAINT "deadline_extension_requests_proposition_id_fkey"
  FOREIGN KEY ("proposition_id") REFERENCES "public"."propositions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_extension_requests_deadline_id_fkey"
  FOREIGN KEY ("deadline_id") REFERENCES "public"."deadlines"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_extension_requests_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_extension_requests_registered_by_id_fkey"
  FOREIGN KEY ("registered_by_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "deadline_extension_requests_decided_by_id_fkey"
  FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."deadline_extensions"
  ADD CONSTRAINT "deadline_extensions_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "public"."deadline_extension_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."deadline_suspensions"
  ADD CONSTRAINT "deadline_suspensions_resumed_by_id_fkey"
  FOREIGN KEY ("resumed_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."deadline_extension_requests"
  ADD CONSTRAINT "deadline_extension_requests_days_positive"
  CHECK ("requested_days" IS NULL OR "requested_days" > 0);

-- Holiday scopes are controlled data; unsupported legacy values block deployment explicitly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "public"."holidays"
    WHERE "scope" NOT IN ('NATIONAL', 'STATE', 'MUNICIPAL', 'INSTITUTIONAL')
  ) THEN
    RAISE EXCEPTION 'Há feriados com escopo não suportado pela Fase 3';
  END IF;
END $$;

DROP INDEX "public"."holidays_date_scope_key";
ALTER TABLE "public"."holidays" ALTER COLUMN "scope" DROP DEFAULT;
ALTER TABLE "public"."holidays"
  ALTER COLUMN "scope" TYPE "public"."HolidayScope"
  USING "scope"::text::"public"."HolidayScope";
ALTER TABLE "public"."holidays"
  ALTER COLUMN "scope" SET DEFAULT 'MUNICIPAL'::"public"."HolidayScope";
CREATE UNIQUE INDEX "holidays_date_scope_key" ON "public"."holidays" ("date", "scope");

-- Database-level concurrency and link invariants.
CREATE UNIQUE INDEX "proposition_documents_one_primary_idx"
  ON "public"."proposition_documents" ("proposition_id") WHERE "role" = 'PRIMARY';
CREATE UNIQUE INDEX "response_documents_one_primary_idx"
  ON "public"."response_documents" ("response_id") WHERE "role" = 'PRIMARY';

ALTER TABLE "public"."association_evaluations"
  ADD CONSTRAINT "association_evaluations_scores_range"
  CHECK (
    ("top_score" IS NULL OR ("top_score" >= 0 AND "top_score" <= 1))
    AND ("second_score" IS NULL OR ("second_score" >= 0 AND "second_score" <= 1))
    AND ("margin" IS NULL OR ("margin" >= 0 AND "margin" <= 1))
  );

-- Required deterministic policies are installed for existing databases as well as fresh seeds.
INSERT INTO "public"."system_settings"
  ("id", "key", "value", "value_type", "description", "version", "created_at", "updated_at")
VALUES
  (
    gen_random_uuid(),
    'deadlines.policy.REQUEST',
    '{"policyVersion":1,"initialResponseDays":15,"extensionDays":15,"countingMode":"CALENDAR_DAYS","timezone":"America/Sao_Paulo","dueSoonDays":3,"suspensionEnabled":true,"startDayRule":"EXCLUDE_START_DATE","nonBusinessDueDateRule":"NEXT_BUSINESS_DAY","holidayScopes":["NATIONAL","STATE","MUNICIPAL","INSTITUTIONAL"]}'::jsonb,
    'JSON'::"public"."SettingValueType",
    'Política versionada de prazo aplicável a requerimentos.',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(),
    'deadlines.policy.INDICATION',
    '{"policyVersion":1,"initialResponseDays":15,"extensionDays":15,"countingMode":"CALENDAR_DAYS","timezone":"America/Sao_Paulo","dueSoonDays":3,"suspensionEnabled":true,"startDayRule":"EXCLUDE_START_DATE","nonBusinessDueDateRule":"NEXT_BUSINESS_DAY","holidayScopes":["NATIONAL","STATE","MUNICIPAL","INSTITUTIONAL"]}'::jsonb,
    'JSON'::"public"."SettingValueType",
    'Política versionada de prazo aplicável a indicações.',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(),
    'association.signalWeights',
    '{"explicitReference":0.5,"number":0.15,"year":0.1,"type":0.1,"protocol":0.05,"subject":0.05,"temporal":0.05}'::jsonb,
    'JSON'::"public"."SettingValueType",
    'Pesos normalizados dos sinais determinísticos de associação.',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(),
    'association.autoThreshold',
    '0.9'::jsonb,
    'DECIMAL'::"public"."SettingValueType",
    'Pontuação mínima para associação automática.',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(),
    'association.minimumMargin',
    '0.15'::jsonb,
    'DECIMAL'::"public"."SettingValueType",
    'Diferença mínima entre o primeiro e o segundo candidato.',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("key") DO NOTHING;
