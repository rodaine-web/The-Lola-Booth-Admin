UPDATE integration_connections
SET metadata = metadata || '{"supported":["development","microsoft"],"test_mode":true}'::jsonb,
    updated_at = now()
WHERE category = 'EMAIL'
  AND provider = 'EMAIL_PROVIDER';

INSERT INTO integration_connections (category, provider, status, metadata)
SELECT 'EMAIL', 'EMAIL_PROVIDER', 'DISCONNECTED', '{"supported":["development","microsoft"],"test_mode":true}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM integration_connections
  WHERE category = 'EMAIL'
    AND provider = 'EMAIL_PROVIDER'
);
