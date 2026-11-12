-- Explicit targeted migration only. Never auto-run by the general migrator.
-- Append-only private artifact store; no existing table, account, role or privilege changes.
CREATE TABLE hanq.private_script_artifacts (
 era text NOT NULL CHECK(era ~ '^[a-z][a-z0-9_-]{0,63}$'),
 artifact_kind text NOT NULL CHECK(artifact_kind ~ '^[a-z][a-z0-9_-]{0,63}$'),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 projection_sha256 text NOT NULL CHECK(projection_sha256 ~ '^[a-f0-9]{64}$'),
 byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 512000),
 payload bytea NOT NULL CHECK(octet_length(payload) BETWEEN 1 AND 512000),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(era,artifact_kind,source_sha256),
 CHECK(octet_length(payload)=byte_length),
 CHECK(encode(sha256(payload),'hex')=content_sha256)
);
