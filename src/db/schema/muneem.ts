/**
 * Muneem Ji domain schema — all CA practice operating system tables.
 * Financial invariant: all monetary amounts are stored as BIGINT in smallest
 * currency unit (paise for INR, cents for CAD/EUR). Never DECIMAL or float.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  char,
  date,
  bigint,
  boolean,
  integer,
  numeric,
  jsonb,
  unique,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./user"; // Indie Kit's app_user table (CA staff are app_users)

// ---------------------------------------------------------------------------
// Firms & Users
// ---------------------------------------------------------------------------

export const accountantFirms = pgTable("accountant_firms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  country: char("country", { length: 2 }).notNull().default("IN"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// CA staff are rows in app_user with role='ca_admin'|'ca_staff' and firmId set.
// See src/db/schema/user.ts for those extra columns.

// ---------------------------------------------------------------------------
// Client Organisations
// ---------------------------------------------------------------------------

export const clientOrgs = pgTable("client_orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  firmId: uuid("firm_id")
    .notNull()
    .references(() => accountantFirms.id),
  name: text("name").notNull(),
  country: char("country", { length: 2 }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  taxRegime: text("tax_regime", {
    enum: ["GST_INDIA", "VAT_EU", "GST_HST_CANADA"],
  }).notNull(),
  taxNumber: text("tax_number"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const clientContacts = pgTable(
  "client_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientOrgId: uuid("client_org_id")
      .notNull()
      .references(() => clientOrgs.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    hasAccount: boolean("has_account").notNull().default(false),
    inviteToken: text("invite_token").unique(),
    inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("client_contacts_org_email").on(table.clientOrgId, table.email),
  ]
);

export const clientUsers = pgTable("client_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => clientContacts.id)
    .unique(),
  clientOrgId: uuid("client_org_id")
    .notNull()
    .references(() => clientOrgs.id),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Guest tokens (unauthenticated upload links)
// ---------------------------------------------------------------------------

export const guestTokens = pgTable("guest_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientOrgId: uuid("client_org_id")
    .notNull()
    .references(() => clientOrgs.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdBy: text("created_by") // references app_user.id (CA staff)
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Bank Statements & Transactions (D02 / D03)
// ---------------------------------------------------------------------------

export const bankStatements = pgTable(
  "bank_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientOrgId: uuid("client_org_id")
      .notNull()
      .references(() => clientOrgs.id),
    // Either a CA staff member or a BO client uploaded — exactly one must be set.
    uploadedByUser: text("uploaded_by_user").references(() => users.id), // CA staff (app_user)
    uploadedByClient: uuid("uploaded_by_client").references(
      () => clientUsers.id
    ),
    s3Key: text("s3_key").notNull(),
    filename: text("filename").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    currency: char("currency", { length: 3 }).notNull(),
    scanStatus: text("scan_status", {
      enum: ["pending", "clean", "infected", "error"],
    })
      .notNull()
      .default("pending"),
    status: text("status", {
      enum: ["processing", "phase1_complete", "parsed", "empty", "failed"],
    })
      .notNull()
      .default("processing"),
    phase1Markdown: text("phase1_markdown"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "uploaded_by_one_party",
      sql`(${table.uploadedByUser} IS NOT NULL AND ${table.uploadedByClient} IS NULL) OR (${table.uploadedByUser} IS NULL AND ${table.uploadedByClient} IS NOT NULL)`
    ),
  ]
);

export const bankTransactions = pgTable(
  "bank_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    statementId: uuid("statement_id")
      .notNull()
      .references(() => bankStatements.id),
    clientOrgId: uuid("client_org_id")
      .notNull()
      .references(() => clientOrgs.id),
    transactionDate: date("transaction_date").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    description: text("description").notNull(),
    needsInvoice: boolean("needs_invoice").notNull().default(false),
    matchStatus: text("match_status", {
      enum: ["unmatched", "matched", "flagged", "out_of_scope"],
    })
      .notNull()
      .default("unmatched"),
    dedupeKey: text("dedupe_key"),
    category: text("category", {
      enum: [
        "vendor_payment",
        "customer_receipt",
        "salary",
        "bank_charge",
        "inter_account_transfer",
        "loan_emi",
        "owner_drawing",
        "tax_payment",
        "unknown",
      ],
    }),
    reasoning: text("reasoning"),
    interpretationMethod: text("interpretation_method", {
      enum: [
        "rule_known_vendor",
        "rule_known_customer",
        "rule_active_loan",
        "rule_inter_account",
        "rule_owner_drawing",
        "llm",
        "llm_fallback",
      ],
    }),
    interpretationConfidence: numeric("interpretation_confidence", {
      precision: 3,
      scale: 2,
      mode: "string",
    }),
    matchedKnownVendorName: text("matched_known_vendor_name"),
    matchedActiveLoanLender: text("matched_active_loan_lender"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("bank_transactions_statement_dedupe_key").on(
      table.statementId,
      table.dedupeKey
    ),
  ]
);

// ---------------------------------------------------------------------------
// Bank Parser Scripts (D02 — pdfplumber script cache)
// ---------------------------------------------------------------------------

export const bankParserScripts = pgTable(
  "bank_parser_scripts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => accountantFirms.id),
    bankIdentifier: text("bank_identifier").notNull(),
    bankName: text("bank_name").notNull(),
    country: char("country", { length: 2 }).notNull(),
    scriptCode: text("script_code").notNull(),
    contentHash: text("content_hash").notNull(),
    version: integer("version").notNull().default(1),
    generatedBy: text("generated_by").notNull().default("claude-opus-4-6"),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    headerTextHash: text("header_text_hash"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("bank_parser_scripts_firm_bank_active_key")
      .on(table.firmId, table.bankIdentifier)
      .where(sql`is_active = true`),
  ]
);

export const statementParseLog = pgTable("statement_parse_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  firmId: uuid("firm_id")
    .notNull()
    .references(() => accountantFirms.id),
  statementId: uuid("statement_id")
    .notNull()
    .references(() => bankStatements.id),
  parserScriptId: uuid("parser_script_id").references(
    () => bankParserScripts.id
  ),
  parseMethod: text("parse_method", {
    enum: ["pdfplumber_cached", "pdfplumber_new", "csv_direct"],
  }).notNull(),
  balanceCheckPass: boolean("balance_check_pass").notNull(),
  transactionsFound: integer("transactions_found").notNull(),
  openingBalance: bigint("opening_balance", { mode: "bigint" }),
  closingBalance: bigint("closing_balance", { mode: "bigint" }),
  computedClosing: bigint("computed_closing", { mode: "bigint" }),
  normalisationMode: text("normalisation_mode", {
    enum: ["llm", "fallback", "skipped"],
  }),
  extractionRowCount: integer("extraction_row_count"),
  normalisedRowCount: integer("normalised_row_count"),
  extractionSumMinor: bigint("extraction_sum_minor", { mode: "bigint" }),
  normalisedSumMinor: bigint("normalised_sum_minor", { mode: "bigint" }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Documents (invoices / receipts) — D05 OCR input
// ---------------------------------------------------------------------------

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientOrgId: uuid("client_org_id")
    .notNull()
    .references(() => clientOrgs.id),
  submittedByClient: uuid("submitted_by_client").references(
    () => clientUsers.id
  ),
  submittedByGuest: uuid("submitted_by_guest").references(() => guestTokens.id),
  s3Key: text("s3_key").notNull(),
  filename: text("filename").notNull(),
  fileType: text("file_type", { enum: ["pdf", "image"] }).notNull(),
  scanStatus: text("scan_status", {
    enum: ["pending", "clean", "infected", "error"],
  })
    .notNull()
    .default("pending"),
  ocrStatus: text("ocr_status", {
    enum: ["pending", "complete", "needs_review", "failed"],
  })
    .notNull()
    .default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const documentExtractions = pgTable("document_extractions", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id)
    .unique(),
  vendorName: text("vendor_name"),
  vendorTaxNumber: text("vendor_tax_number"),
  invoiceNumber: text("invoice_number"),
  invoiceDate: date("invoice_date"),
  baseAmountMinor: bigint("base_amount_minor", { mode: "bigint" }),
  taxAmountMinor: bigint("tax_amount_minor", { mode: "bigint" }),
  cgstAmountMinor: bigint("cgst_amount_minor", { mode: "bigint" }),
  sgstAmountMinor: bigint("sgst_amount_minor", { mode: "bigint" }),
  igstAmountMinor: bigint("igst_amount_minor", { mode: "bigint" }),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }),
  totalAmountMinor: bigint("total_amount_minor", { mode: "bigint" }),
  currency: char("currency", { length: 3 }),
  confidence: numeric("confidence", { precision: 4, scale: 3 }),
  rawJson: jsonb("raw_json"),
  reviewed: boolean("reviewed").notNull().default(false),
  reviewedBy: text("reviewed_by").references(() => users.id), // CA staff (app_user)
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const transactionDocumentMatches = pgTable(
  "transaction_document_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankTransactionId: uuid("bank_transaction_id")
      .notNull()
      .references(() => bankTransactions.id),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    matchType: text("match_type", { enum: ["auto", "manual"] }).notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    matchedBy: text("matched_by").references(() => users.id), // CA staff (app_user)
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }
);

// ---------------------------------------------------------------------------
// Double-Entry Journal (D07 — written ONLY by lib/accounting/double-entry-engine.ts)
// ---------------------------------------------------------------------------

export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientOrgId: uuid("client_org_id")
    .notNull()
    .references(() => clientOrgs.id),
  transactionId: text("transaction_id").notNull(),
  entryDate: date("entry_date").notNull(),
  period: text("period").notNull(),
  accountCode: text("account_code").notNull(),
  accountName: text("account_name").notNull(),
  drCr: text("dr_cr", { enum: ["DR", "CR"] }).notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  narration: text("narration").notNull(),
  partyName: text("party_name"),
  partyTaxNumber: text("party_tax_number"),
  invoiceRef: text("invoice_ref"),
  taxAmountMinor: bigint("tax_amount_minor", { mode: "bigint" }),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }),
  sourceAccount: text("source_account"),
  matchStatus: text("match_status", {
    enum: ["matched", "unmatched", "flagged"],
  }).notNull(),
  documentId: uuid("document_id").references(() => documents.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const chartOfAccounts = pgTable(
  "chart_of_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientOrgId: uuid("client_org_id")
      .notNull()
      .references(() => clientOrgs.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    accountType: text("account_type", {
      enum: ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"],
    }).notNull(),
    taxRole: text("tax_role"),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("chart_of_accounts_org_code").on(table.clientOrgId, table.code),
  ]
);

// ---------------------------------------------------------------------------
// Client Knowledge (D03 context — known vendors, loans, accounts)
// ---------------------------------------------------------------------------

export type BankAccountEntry = {
  account_label: string;
  bank_name: string;
  account_number_last4: string;
  is_primary_operating: boolean;
  notes?: string;
};

export type KnownVendor = {
  name: string;
  description_patterns: string[];
  typical_amount_min_minor: string;
  typical_amount_max_minor: string;
  category: string;
  needs_invoice: boolean;
  notes?: string;
};

export type KnownCustomer = {
  name: string;
  description_patterns: string[];
  typical_amount_min_minor: string;
  typical_amount_max_minor: string;
  notes?: string;
};

export type ActiveLoan = {
  lender: string;
  description_pattern: string;
  approximate_amount_minor: string;
  debit_day_of_month: number | null;
  loan_type: "term_loan" | "vehicle" | "equipment" | "other";
  notes?: string;
};

export type Seasonality = {
  peak_months: number[];
  lean_months: number[];
  notes?: string;
};

export type OwnerDrawingsPattern = {
  method: "upi_transfer" | "cash_withdrawal" | "salary" | "mixed";
  approximate_monthly_minor: string;
  typical_description_pattern?: string;
  notes?: string;
};

export type CashDepositPattern = {
  frequency: "daily" | "weekly" | "fortnightly" | "irregular";
  typical_amount_min_minor: string;
  typical_amount_max_minor: string;
  notes?: string;
};

export const clientProfiles = pgTable("client_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientOrgId: uuid("client_org_id")
    .notNull()
    .references(() => clientOrgs.id)
    .unique(),
  legalStructure: text("legal_structure", {
    enum: [
      "sole_proprietorship",
      "partnership",
      "llp",
      "private_limited",
      "public_limited",
      "trust",
      "other",
    ],
  }).notNull(),
  businessType: text("business_type", {
    enum: ["manufacturer", "trader", "service_provider", "mixed"],
  }).notNull(),
  industry: text("industry").notNull(),
  description: text("description").notNull(),
  gstRegistrationType: text("gst_registration_type", {
    enum: ["regular", "composition", "exempt", "unregistered"],
  }).notNull(),
  primaryTransactionMode: text("primary_transaction_mode", {
    enum: ["mostly_digital", "mixed", "cash_heavy"],
  }).notNull(),
  bankAccounts: jsonb("bank_accounts")
    .$type<BankAccountEntry[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  invoiceSoftware: text("invoice_software", {
    enum: ["tally", "busy", "zoho_books", "quickbooks", "manual", "other"],
  }).notNull(),
  hasInterCompanyTransactions: boolean("has_inter_company_transactions")
    .notNull()
    .default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const clientKnowledge = pgTable("client_knowledge", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientOrgId: uuid("client_org_id")
    .notNull()
    .references(() => clientOrgs.id)
    .unique(),
  knownVendors: jsonb("known_vendors")
    .$type<KnownVendor[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  knownCustomers: jsonb("known_customers")
    .$type<KnownCustomer[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  activeLoans: jsonb("active_loans")
    .$type<ActiveLoan[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  seasonality: jsonb("seasonality").$type<Seasonality>(),
  ownerDrawingsPattern: jsonb("owner_drawings_pattern").$type<OwnerDrawingsPattern>(),
  cashDepositPattern: jsonb("cash_deposit_pattern").$type<CashDepositPattern>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const transactionCategoryCorrections = pgTable(
  "transaction_category_corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientOrgId: uuid("client_org_id")
      .notNull()
      .references(() => clientOrgs.id),
    bankTransactionId: uuid("bank_transaction_id")
      .notNull()
      .references(() => bankTransactions.id),
    engineNeedsInvoice: boolean("engine_needs_invoice").notNull(),
    engineCategory: text("engine_category"),
    engineReasoning: text("engine_reasoning"),
    correctedNeedsInvoice: boolean("corrected_needs_invoice").notNull(),
    correctedCategory: text("corrected_category"),
    correctionNote: text("correction_note"),
    correctedBy: text("corrected_by")
      .notNull()
      .references(() => users.id), // CA staff (app_user)
    correctedAt: timestamp("corrected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    promotedToKnowledge: boolean("promoted_to_knowledge")
      .notNull()
      .default(false),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
  }
);
