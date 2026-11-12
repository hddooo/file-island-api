-- Private request staging only. No published learning data or roles are changed.
CREATE TABLE hanq.question_requests (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES hanq.users(id), request_id uuid NOT NULL,
 subject text NOT NULL CHECK(subject IN ('toeic','history')),part integer,
 source_label text NOT NULL,payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','needs_revision','content_reviewed','ready_for_publish','published')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),review_note text NOT NULL DEFAULT '',review_payload jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((subject='toeic' AND part IS NOT NULL AND part BETWEEN 1 AND 7) OR (subject='history' AND part IS NULL)),UNIQUE(owner_id,request_id)
);
CREATE INDEX question_requests_owner ON hanq.question_requests(owner_id,created_at DESC,id);
CREATE TABLE hanq.question_request_assets (
 id uuid PRIMARY KEY,request_id uuid NOT NULL REFERENCES hanq.question_requests(id),
 purpose text NOT NULL CHECK(purpose IN ('source_image','clean_image','audio')),
 media_type text NOT NULL CHECK(media_type IN ('image/png','image/jpeg','image/webp','audio/mpeg','audio/wav')),
 bytes bytea NOT NULL CHECK(octet_length(bytes)>0 AND octet_length(bytes)<=16777216),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((purpose='audio' AND media_type IN ('audio/mpeg','audio/wav')) OR (purpose IN ('source_image','clean_image') AND media_type IN ('image/png','image/jpeg','image/webp') AND octet_length(bytes)<=8388608))
);
CREATE INDEX question_request_assets_request ON hanq.question_request_assets(request_id,created_at,id);
REVOKE ALL ON hanq.question_requests,hanq.question_request_assets FROM PUBLIC;
