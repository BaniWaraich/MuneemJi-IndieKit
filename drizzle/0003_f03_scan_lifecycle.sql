CREATE TABLE "scan_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"s3_key" text NOT NULL,
	"attempt" integer NOT NULL,
	"result" text NOT NULL,
	"reason" text,
	"provider_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_statements" ADD COLUMN "scan_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD COLUMN "quarantined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "scan_status_enum" CHECK ("bank_statements"."scan_status" IN ('pending', 'scanning', 'clean', 'infected', 'error'));