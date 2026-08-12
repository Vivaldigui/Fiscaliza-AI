/**
 * Shared by the API (which computes `Analysis.inputHash` at creation time)
 * and the worker (which actually runs the pipeline), so both processes
 * agree on what invalidates a cached analysis. Bump on any semantic change
 * to the structured-output contract or to the merge/validation pipeline.
 */
export const SCHEMA_VERSION = 'phase4-schema-v1';
export const ANALYSIS_VERSION = 'phase4-pipeline-v1';

/**
 * Embedding contract (provider + model + dimension + normalization + pipeline):
 * changing any of those bumps this constant so previously indexed chunks get
 * re-indexed (see ADR-002). Mirrored in the worker's environment validation.
 */
export const EMBEDDING_VERSION = 'phase5a-embedding-v1';

/** Version of the web conversation answer contract (generated in the worker). */
export const WEB_ANSWER_VERSION = 'phase5a-web-answer-v1';

/**
 * Version of the deterministic PostgreSQL-only answers (status, protocol,
 * authors, deadlines) that the web conversation pipeline resolves without
 * calling the LLM. Bump on any semantic change to those templates.
 */
export const WEB_STRUCTURED_VERSION = 'phase5a-web-structured-v1';
