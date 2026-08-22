CREATE TABLE "gmail_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"gmail_address" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expiry" timestamp with time zone NOT NULL,
	"scopes" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "client_users" ADD COLUMN "onboarding_progress" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "gmail_connections" ADD CONSTRAINT "gmail_connections_user_id_client_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."client_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gmail_connections_status_idx" ON "gmail_connections" USING btree ("status");
