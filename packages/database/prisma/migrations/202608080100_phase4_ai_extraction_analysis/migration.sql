-- Phase 4: structured AI extraction/analysis evidence and versioned requested items.
-- No prior migration is edited. `requested_items` remained unused through Phase 3;
-- this migration links every item to the exact Analysis (REQUEST_EXTRACTION /
-- INDICATION_EXTRACTION) that produced it and to the immutable DocumentPage it was
-- read from, and supports non-destructive re-extraction via an `active` flag.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "public"."requested_items") THEN
    RAISE EXCEPTION 'requested_items possui linhas pré-existentes sem análise de extração associável; migration abortada.';
  END IF;
END $$;

ALTER TABLE "public"."requested_items"
  ADD COLUMN "extraction_analysis_id" UUID,
  ADD COLUMN "source_document_page_id" UUID,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "public"."requested_items" ALTER COLUMN "extraction_analysis_id" SET NOT NULL;

DROP INDEX "public"."requested_items_proposition_id_sequence_key";

CREATE UNIQUE INDEX "requested_items_proposition_id_sequence_active_idx"
  ON "public"."requested_items" ("proposition_id", "sequence") WHERE "active";
CREATE INDEX "requested_items_proposition_id_active_idx"
  ON "public"."requested_items" ("proposition_id", "active");
CREATE INDEX "requested_items_extraction_analysis_id_idx"
  ON "public"."requested_items" ("extraction_analysis_id");
CREATE INDEX "requested_items_source_document_page_id_idx"
  ON "public"."requested_items" ("source_document_page_id");

ALTER TABLE "public"."requested_items"
  ADD CONSTRAINT "requested_items_extraction_analysis_id_fkey"
  FOREIGN KEY ("extraction_analysis_id") REFERENCES "public"."analyses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "requested_items_source_document_page_id_fkey"
  FOREIGN KEY ("source_document_page_id") REFERENCES "public"."document_pages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Required deterministic policy for existing databases as well as fresh seeds
-- (mirrors the pattern established by the Phase 3 migration).
INSERT INTO "public"."system_settings"
  ("id", "key", "value", "value_type", "description", "version", "created_at", "updated_at")
VALUES
  (
    gen_random_uuid(),
    'analysis.confidence.normal',
    '0.85'::jsonb,
    'DECIMAL'::"public"."SettingValueType",
    'Confiança mínima para apresentação sem aviso.',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    gen_random_uuid(),
    'analysis.confidence.warning',
    '0.60'::jsonb,
    'DECIMAL'::"public"."SettingValueType",
    'Confiança mínima para apresentação com aviso; abaixo disso, revisão humana.',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("key") DO NOTHING;
