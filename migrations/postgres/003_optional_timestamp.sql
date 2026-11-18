ALTER DOMAIN utc_timestamp DROP CONSTRAINT utc_timestamp_check;
ALTER DOMAIN utc_timestamp ADD CONSTRAINT utc_timestamp_check CHECK(
  VALUE IS NULL OR (VALUE ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' AND VALUE::timestamptz IS NOT NULL)
);
