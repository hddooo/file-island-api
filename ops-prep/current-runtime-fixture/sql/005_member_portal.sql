-- Additive only: no role assignment, no member or entitlement updates.
CREATE TABLE hanq.member_roles(user_id uuid PRIMARY KEY REFERENCES hanq.users(id),role text NOT NULL CHECK(role='ADMIN'));
CREATE TABLE hanq.member_access_logs(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,user_id uuid NOT NULL REFERENCES hanq.users(id),event text NOT NULL CHECK(event IN('signup','signin')),created_at timestamptz NOT NULL);
CREATE INDEX member_access_logs_user ON hanq.member_access_logs(user_id,id DESC);
CREATE TABLE hanq.inquiries(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES hanq.users(id),request_id uuid NOT NULL,title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120),created_at timestamptz NOT NULL,UNIQUE(user_id,request_id));
CREATE TABLE hanq.inquiry_messages(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,inquiry_id uuid NOT NULL REFERENCES hanq.inquiries(id),sender_id uuid NOT NULL REFERENCES hanq.users(id),sender_role text NOT NULL CHECK(sender_role IN('member','admin')),request_id uuid NOT NULL,body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 4000),created_at timestamptz NOT NULL,UNIQUE(inquiry_id,sender_id,request_id));
CREATE INDEX inquiry_messages_order ON hanq.inquiry_messages(inquiry_id,id);
CREATE TABLE hanq.admin_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id uuid NOT NULL REFERENCES hanq.users(id),action text NOT NULL,target_id uuid NOT NULL,created_at timestamptz NOT NULL);
