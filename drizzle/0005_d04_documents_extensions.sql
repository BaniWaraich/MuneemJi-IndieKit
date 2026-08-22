-- D04 document upload: columns and indexes were added to the Drizzle snapshot in 0004
-- but never migrated. Without this, getFirmStorageBytes() fails on upload routes.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "submitted_by_user" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "file_size_bytes" bigint;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_submitted_by_user_app_user_id_fk" FOREIGN KEY ("submitted_by_user") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_client_org_id_idx" ON "documents" USING btree ("client_org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_created_at_idx" ON "documents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_submitted_by_user_idx" ON "documents" USING btree ("submitted_by_user");--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_submitted_by_one_party";--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_submitted_by_one_party" CHECK (
  (
    ("documents"."submitted_by_user" IS NOT NULL)::int +
    ("documents"."submitted_by_client" IS NOT NULL)::int +
    ("documents"."submitted_by_guest" IS NOT NULL)::int
  ) = 1
);
