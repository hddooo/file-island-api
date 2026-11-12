-- Private question diagrams stay behind the existing owner + live-session checks.
CREATE TABLE hanq.toeic_cbt_images (
 user_id uuid NOT NULL REFERENCES hanq.users(id),
 collection_id uuid NOT NULL,
 asset_key text NOT NULL CHECK(asset_key ~ '^[a-f0-9]{64}$'),
 media_type text NOT NULL CHECK(media_type IN ('image/png','image/jpeg','image/webp')),
 bytes bytea NOT NULL CHECK(octet_length(bytes)>0 AND octet_length(bytes)<=8388608),
 PRIMARY KEY(user_id,collection_id,asset_key),
 FOREIGN KEY(collection_id,user_id) REFERENCES hanq.toeic_cbt_collections(id,user_id)
);
REVOKE ALL ON hanq.toeic_cbt_images FROM PUBLIC;
