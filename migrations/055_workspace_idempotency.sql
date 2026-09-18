-- Optional client-generated request identity. Repeated transport attempts are one pursuit.
CREATE UNIQUE INDEX IF NOT EXISTS thought_chains_client_request_id
ON thought_chains ((ponder_state->>'clientRequestId'))
WHERE ponder_state->>'clientRequestId' IS NOT NULL;
