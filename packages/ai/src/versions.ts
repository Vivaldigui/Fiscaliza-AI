/**
 * Shared by the API (which computes `Analysis.inputHash` at creation time)
 * and the worker (which actually runs the pipeline), so both processes
 * agree on what invalidates a cached analysis. Bump on any semantic change
 * to the structured-output contract or to the merge/validation pipeline.
 */
export const SCHEMA_VERSION = 'phase4-schema-v1';
export const ANALYSIS_VERSION = 'phase4-pipeline-v1';
