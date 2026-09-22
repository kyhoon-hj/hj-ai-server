import { Prisma } from '@prisma/client';

export const CONSOLE_ENDPOINTS = [
  '/bedrock/converse',
  '/bedrock/text-response',
  '/bedrock/general-answers',
  '/knowledge/answers',
  '/conversation/v1/turns',
  '/bedrock',
  'unknown',
] as const;

export type ConsoleUsageFilters = {
  endpoint?: string;
  appcode?: string;
  modelId?: string;
  status?: 'success' | 'failed' | 'unknown';
};

// The same attributed request set drives usage, request logs, detail and CSV.
// Original timestamps stay visible; accounting follows the reservation admission.
export function consoleUsageEvents(
  organizationId: string,
  from?: Date,
  to?: Date,
  filters: ConsoleUsageFilters = {},
) {
  const conditions = [Prisma.sql`organization_id = ${organizationId}::uuid`];
  if (from) conditions.push(Prisma.sql`occurred_at >= ${from}`);
  if (to) conditions.push(Prisma.sql`occurred_at < ${to}`);
  if (filters.appcode)
    conditions.push(Prisma.sql`appcode = ${filters.appcode}`);
  if (filters.endpoint)
    conditions.push(Prisma.sql`endpoint = ${filters.endpoint}`);
  if (filters.modelId)
    conditions.push(
      Prisma.sql`COALESCE(model_id, 'unknown') = ${filters.modelId}`,
    );
  if (filters.status) conditions.push(Prisma.sql`status = ${filters.status}`);
  return Prisma.sql`
    WITH raw_requests AS (
      SELECT log.id, 'bedrock'::text AS source, log.appcode,
        log.searchat AS original_at, log.request_id,
        COALESCE(log.endpoint, '/bedrock') AS endpoint,
        COALESCE(log.status, 'unknown') AS status,
        COALESCE(log.result, 'unknown') AS result,
        log.failure_stage, log.error_code, log.model_id,
        NULL::text AS embedding_model, log.responsetime,
        log.inputtokens, log.outputtokens, log.totaltokens,
        0 AS matched_chunk_count,
        log.searchword <> '[CONTENT_OMITTED]' AS content_stored,
        NULL::jsonb AS execution
      FROM bedrock_search_log log
      UNION ALL
      SELECT log.id, 'knowledge', log.appcode, log.created_at, log.request_id,
        COALESCE(log.execution->>'endpoint', '/knowledge/answers'),
        CASE WHEN log.execution->>'answerStatus' = 'request_failed' THEN 'failed'
             WHEN log.execution->>'answerStatus' IS NOT NULL THEN 'success'
             ELSE 'unknown' END,
        COALESCE(log.execution->>'answerStatus', 'unknown'),
        log.execution->>'failedStage', log.execution->>'errorCode',
        log.model_id, log.embedding_model, log.responsetime,
        log.inputtokens, log.outputtokens, log.totaltokens,
        CASE WHEN jsonb_typeof(log.matched_chunk_ids) = 'array'
          THEN jsonb_array_length(log.matched_chunk_ids) ELSE 0 END,
        (log.question <> '[CONTENT_OMITTED]' OR log.response IS NOT NULL), log.execution
      FROM knowledge_query_log log
      UNION ALL
      SELECT metric.id, 'conversation', metric.appcode, metric.created_at, metric.request_id::text,
        COALESCE(metric.endpoint, '/conversation/v1/turns'),
        CASE WHEN metric.status = 'SUCCEEDED' THEN 'success'
             WHEN metric.status = 'FAILED' THEN 'failed' ELSE 'unknown' END,
        COALESCE(metric.result, CASE WHEN metric.status = 'SUCCEEDED' THEN 'completed'
          WHEN metric.status = 'FAILED' THEN 'request_failed' ELSE 'unknown' END),
        metric.failure_stage, metric.error_code, metric.model_id, NULL::text,
        metric.latency_ms, metric.input_tokens, metric.output_tokens, metric.total_tokens,
        metric.result_count, false, jsonb_build_object('policyVersion', metric.policy_version)
      FROM family_conversation_metric metric
    ), attributed_requests AS (
      SELECT log.source || ':' || log.id::text AS log_id, log.source, log.appcode,
        CASE WHEN reservation.id IS NULL THEN log.original_at
             WHEN to_char(reservation.created_at, 'YYYY-MM') = reservation.period_key
               THEN reservation.created_at
             ELSE (reservation.period_key || '-01')::timestamp END AS occurred_at,
        log.original_at,
        CASE WHEN reservation.id IS NULL THEN ownership.organization_id
             ELSE reservation.organization_id END AS organization_id,
        log.request_id, log.endpoint, log.status, log.result,
        log.failure_stage, log.error_code, log.model_id, log.embedding_model,
        log.responsetime, log.inputtokens, log.outputtokens,
        COALESCE(log.totaltokens, CASE WHEN reservation.state = 'SETTLED'
          THEN reservation.actual_tokens END) AS totaltokens,
        log.matched_chunk_count, log.content_stored, log.execution,
        reservation.id AS reservation_id,
        (reservation.recovery_key IS NOT NULL) AS recovered,
        CASE WHEN log.totaltokens IS NOT NULL THEN 'measured'
             WHEN reservation.state = 'SETTLED' AND reservation.actual_tokens IS NOT NULL
               THEN 'settled' ELSE 'unmeasured' END AS token_source
      FROM raw_requests log
      LEFT JOIN console_usage_reservation reservation
        ON reservation.usage_log_source = log.source AND reservation.usage_log_id = log.id
      LEFT JOIN appinfo app ON app.appcode = log.appcode
      LEFT JOIN console_app_ownership ownership ON ownership.app_info_id = app.id
      UNION ALL
      SELECT 'recovery:' || reservation.id::text, 'recovery', reservation.appcode,
        CASE WHEN to_char(reservation.created_at, 'YYYY-MM') = reservation.period_key
          THEN reservation.created_at ELSE (reservation.period_key || '-01')::timestamp END,
        reservation.created_at, reservation.organization_id,
        NULL::text,
        CASE WHEN reservation.operation_scope LIKE 'bedrock.%'
               THEN '/' || replace(reservation.operation_scope, '.', '/')
             WHEN reservation.operation_scope = 'knowledge.answer' THEN '/knowledge/answers'
             WHEN reservation.operation_scope LIKE 'conversation:%' THEN '/conversation/v1/turns'
             ELSE 'unknown' END,
        'unknown', 'usage_recovered', NULL::text, NULL::text, NULL::text, NULL::text,
        NULL::int, NULL::int, NULL::int, reservation.recovery_tokens,
        0, false, NULL::jsonb, reservation.id, true, 'recovered'
      FROM console_usage_reservation reservation
      WHERE reservation.state = 'SETTLED' AND reservation.recovery_requests = 1
        AND reservation.usage_log_id IS NULL
    ), request_events AS (
      SELECT * FROM attributed_requests WHERE ${Prisma.join(conditions, ' AND ')}
    )`;
}
