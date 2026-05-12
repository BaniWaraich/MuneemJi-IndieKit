CREATE TABLE "accountant_firms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"country" char(2) DEFAULT 'IN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accountant_firms_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "bank_parser_scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"bank_identifier" text NOT NULL,
	"bank_name" text NOT NULL,
	"country" char(2) NOT NULL,
	"script_code" text NOT NULL,
	"content_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"generated_by" text DEFAULT 'claude-opus-4-6' NOT NULL,
	"last_validated_at" timestamp with time zone,
	"header_text_hash" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_org_id" uuid NOT NULL,
	"uploaded_by_user" text,
	"uploaded_by_client" uuid,
	"s3_key" text NOT NULL,
	"filename" text NOT NULL,
	"period_start" date,
	"period_end" date,
	"currency" char(3) NOT NULL,
	"scan_status" text DEFAULT 'pending' NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"phase1_markdown" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uploaded_by_one_party" CHECK (("bank_statements"."uploaded_by_user" IS NOT NULL AND "bank_statements"."uploaded_by_client" IS NULL) OR ("bank_statements"."uploaded_by_user" IS NULL AND "bank_statements"."uploaded_by_client" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"client_org_id" uuid NOT NULL,
	"transaction_date" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"description" text NOT NULL,
	"needs_invoice" boolean DEFAULT false NOT NULL,
	"match_status" text DEFAULT 'unmatched' NOT NULL,
	"dedupe_key" text,
	"category" text,
	"reasoning" text,
	"interpretation_method" text,
	"interpretation_confidence" numeric(3, 2),
	"matched_known_vendor_name" text,
	"matched_active_loan_lender" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_of_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"account_type" text NOT NULL,
	"tax_role" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chart_of_accounts_org_code" UNIQUE("client_org_id","code")
);
--> statement-breakpoint
CREATE TABLE "client_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"has_account" boolean DEFAULT false NOT NULL,
	"invite_token" text,
	"invite_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_contacts_invite_token_unique" UNIQUE("invite_token"),
	CONSTRAINT "client_contacts_org_email" UNIQUE("client_org_id","email")
);
--> statement-breakpoint
CREATE TABLE "client_knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_org_id" uuid NOT NULL,
	"known_vendors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"known_customers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active_loans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seasonality" jsonb,
	"owner_drawings_pattern" jsonb,
	"cash_deposit_pattern" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_knowledge_client_org_id_unique" UNIQUE("client_org_id")
);
--> statement-breakpoint
CREATE TABLE "client_orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"country" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"tax_regime" text NOT NULL,
	"tax_number" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_org_id" uuid NOT NULL,
	"legal_structure" text NOT NULL,
	"business_type" text NOT NULL,
	"industry" text NOT NULL,
	"description" text NOT NULL,
	"gst_registration_type" text NOT NULL,
	"primary_transaction_mode" text NOT NULL,
	"bank_accounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invoice_software" text NOT NULL,
	"has_inter_company_transactions" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_profiles_client_org_id_unique" UNIQUE("client_org_id")
);
--> statement-breakpoint
CREATE TABLE "client_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"client_org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_users_contact_id_unique" UNIQUE("contact_id"),
	CONSTRAINT "client_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "document_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"vendor_name" text,
	"vendor_tax_number" text,
	"invoice_number" text,
	"invoice_date" date,
	"base_amount_minor" bigint,
	"tax_amount_minor" bigint,
	"cgst_amount_minor" bigint,
	"sgst_amount_minor" bigint,
	"igst_amount_minor" bigint,
	"tax_rate" numeric(5, 2),
	"total_amount_minor" bigint,
	"currency" char(3),
	"confidence" numeric(4, 3),
	"raw_json" jsonb,
	"reviewed" boolean DEFAULT false NOT NULL,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_extractions_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_org_id" uuid NOT NULL,
	"submitted_by_client" uuid,
	"submitted_by_guest" uuid,
	"s3_key" text NOT NULL,
	"filename" text NOT NULL,
	"file_type" text NOT NULL,
	"scan_status" text DEFAULT 'pending' NOT NULL,
	"ocr_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_org_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_org_id" uuid NOT NULL,
	"transaction_id" text NOT NULL,
	"entry_date" date NOT NULL,
	"period" text NOT NULL,
	"account_code" text NOT NULL,
	"account_name" text NOT NULL,
	"dr_cr" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"narration" text NOT NULL,
	"party_name" text,
	"party_tax_number" text,
	"invoice_ref" text,
	"tax_amount_minor" bigint,
	"tax_rate" numeric(5, 2),
	"source_account" text,
	"match_status" text NOT NULL,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statement_parse_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"parser_script_id" uuid,
	"parse_method" text NOT NULL,
	"balance_check_pass" boolean NOT NULL,
	"transactions_found" integer NOT NULL,
	"opening_balance" bigint,
	"closing_balance" bigint,
	"computed_closing" bigint,
	"normalisation_mode" text,
	"extraction_row_count" integer,
	"normalised_row_count" integer,
	"extraction_sum_minor" bigint,
	"normalised_sum_minor" bigint,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_category_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_org_id" uuid NOT NULL,
	"bank_transaction_id" uuid NOT NULL,
	"engine_needs_invoice" boolean NOT NULL,
	"engine_category" text,
	"engine_reasoning" text,
	"corrected_needs_invoice" boolean NOT NULL,
	"corrected_category" text,
	"correction_note" text,
	"corrected_by" text NOT NULL,
	"corrected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promoted_to_knowledge" boolean DEFAULT false NOT NULL,
	"promoted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transaction_document_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_transaction_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"match_type" text NOT NULL,
	"confidence" numeric(4, 3),
	"matched_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "firmId" uuid;--> statement-breakpoint
ALTER TABLE "bank_parser_scripts" ADD CONSTRAINT "bank_parser_scripts_firm_id_accountant_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."accountant_firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_client_org_id_client_orgs_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."client_orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_uploaded_by_user_app_user_id_fk" FOREIGN KEY ("uploaded_by_user") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_uploaded_by_client_client_users_id_fk" FOREIGN KEY ("uploaded_by_client") REFERENCES "public"."client_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_client_org_id_client_orgs_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."client_orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_client_org_id_client_orgs_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."client_orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_org_id_client_orgs_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."client_orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_knowledge" ADD CONSTRAINT "client_knowledge_client_org_id_client_orgs_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."client_orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_orgs" ADD CONSTRAINT "client_orgs_firm_id_accountant_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."accountant_firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_client_org_id_client_orgs_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."client_orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_users" ADD CONSTRAINT "client_users_contact_id_client_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_users" ADD CONSTRAINT "client_users_client_org_id_client_orgs_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."client_orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_reviewed_by_app_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_client_org_id_client_orgs_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."client_orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_submitted_by_client_client_users_id_fk" FOREIGN KEY ("submitted_by_client") REFERENCES "public"."client_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_submitted_by_guest_guest_tokens_id_fk" FOREIGN KEY ("submitted_by_guest") REFERENCES "public"."guest_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_tokens" ADD CONSTRAINT "guest_tokens_client_org_id_client_orgs_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."client_orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_tokens" ADD CONSTRAINT "guest_tokens_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_client_org_id_client_orgs_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."client_orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_parse_log" ADD CONSTRAINT "statement_parse_log_firm_id_accountant_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."accountant_firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_parse_log" ADD CONSTRAINT "statement_parse_log_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_parse_log" ADD CONSTRAINT "statement_parse_log_parser_script_id_bank_parser_scripts_id_fk" FOREIGN KEY ("parser_script_id") REFERENCES "public"."bank_parser_scripts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_category_corrections" ADD CONSTRAINT "transaction_category_corrections_client_org_id_client_orgs_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."client_orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_category_corrections" ADD CONSTRAINT "transaction_category_corrections_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_category_corrections" ADD CONSTRAINT "transaction_category_corrections_corrected_by_app_user_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_document_matches" ADD CONSTRAINT "transaction_document_matches_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_document_matches" ADD CONSTRAINT "transaction_document_matches_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_document_matches" ADD CONSTRAINT "transaction_document_matches_matched_by_app_user_id_fk" FOREIGN KEY ("matched_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_parser_scripts_firm_bank_active_key" ON "bank_parser_scripts" USING btree ("firm_id","bank_identifier") WHERE is_active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_statement_dedupe_key" ON "bank_transactions" USING btree ("statement_id","dedupe_key");