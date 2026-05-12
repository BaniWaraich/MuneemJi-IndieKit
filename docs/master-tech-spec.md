# Master Technical Specification (v2)

> Extracted from `docs/archive/muneem-ji-technical-spec-v2.pdf` on 2026-05-02 via pdftotext.
> Treat this Markdown copy as canonical going forward; the PDF is the historical render.

# 0. Prerequisites — Before Writing Any Code
## 0.1 AWS Account Setup Required from Day One
## 0.2 Anthropic API Key
## 0.3 Domain Setup
## 0.4 Checklist Before Phase 0
# 1. Stack
Local Development Infrastructure
# 2. Core Architecture
# 3. Database Schema
## 3.1 CA Firm and User Tables
## 3.2 CA Website Table
## 3.3 Client Organisation Tables
## 3.4 Independent Business Owner Tables
## 3.5 Lead Inbox Table
## 3.6 Financial Tables
## 3.7 Chart of Accounts
# 4. API Routes
## 4.1 Auth — CA Firm/code
## 4.2 Auth — Business Owner (Linked)
## 4.3 Auth — Independent Business Owner
## 4.4 CA Website Management
## 4.5 CA Verification
## 4.6 Lead Inbox (CA only)
## 4.7 Public Enquiry (unauthenticated)
## 4.8 Client Management (CA only)
## 4.9 Team Management (CA admin only)
## 4.10 Bank Statements (CA or linked BO)
## 4.11 Documents (CA view)
## 4.12 Documents (Linked BO view)
## 4.13 Guest Upload (unauthenticated)
## 4.14 Independent BO (self-service)
## 4.15 Reminders (CA only)

⚠️

## 4.16 Export (CA only)
# 5. Job Queue Workers
## 5.1 website.queue — CA Website Generator
## 5.2 statement.queue — Bank Statement Parser
Phase 1 — Format Detection and Extraction
Phase 2 — Normalisation (GPT-4o mini)
## 5.3 ocr.queue — Invoice OCR
## 5.4 match.queue — Transaction Matching
## 5.5 reminder.queue — Automated Reminders
## 5.6 export.queue — Day Book Export
# 6. Double Entry Engine
Input
V1 Transaction Types (GST_INDIA)
Validation
Jurisdiction Extension Points
# 7. File Upload Flow
# 8. CA Website Serving
# 9. Email Templates
# 10. Security
# 11. Environment Variables
# 12. Development Phases
Track 1 — Private Alpha
Phase 0 — Foundation (Week 1)
Phase 1 — Bank Statement Upload + Parsing (Week 2)
Phase 2 — Document Upload + OCR (Week 3)
Phase 3 — Matching + Double Entry Engine (Week 4)
Phase 4 — Day Book Export + Alpha Hardening (Week 5)
Track 2 — Full Product Build
Phase 5 — CA Auth + Client Management (Week 6)
Phase 6 — CA Website + Verification (Week 7)
Phase 7 — Lead Inbox + Directory (Week 8)
Phase 8 — Independent BO Path (Week 9)
Phase 9 — Reminders + Full Export (Week 10)
Phase 10 — Pre-Launch Hardening (Week 11)
# 13. CLAUDE.md Content (place at repository root)
# 14. Unit Economics Reference
Bank Statement Parsing
CA Website Generation

Storage per CA (Growth tier, year one)
Independent BO Tier

# 0. Prerequisites — Before Writing Any Code
External accounts and services required before development begins. Several have
approval wait times — start them immediately.

## 0.1 AWS Account Setup

⚠️ Required from Day One

AWS is not optional. S3 is needed from Phase 2 (file uploads), SES from Phase 5
(email), and ECS/RDS/ElastiCache at Phase 6 (deployment). Set up the account
before Phase 0 so credentials are ready when each phase needs them.
Step 1 — Create AWS Account
Go to aws.amazon.com → Create an AWS Account
Requires: email, credit card, phone for verification (~15 minutes)
Choose the free tier where available
Step 2 — Create an IAM User (never use root credentials)
IAM → Users → Create User. Username: muneem-dev
Programmatic access only (Access Key ID + Secret Access Key)
Attach policies: AmazonS3FullAccess , AmazonSESFullAccess
Save credentials immediately — the secret is shown only once

⚠️ Never commit to the repository. Goes in

.env.local

only.

Step 3 — Create S3 Buckets
muneem-documents

— all uploaded files (statements, invoices, exports)

muneem-websites

— CA website static assets

Region: ap-south-1 (Mumbai). Block all public access. Enable versioning.
Step 4 — Request SES Production Access

⚠️ Takes 24–48 hours

SES → Account Dashboard → Request Production Access

Explain: transactional emails (invoice reminders, invite links, enquiry
notifications)
Submit on Day 1 even if Phase 5 is weeks away
Verify your own email in sandbox for testing while approval is pending
Step 5 — Verify Sending Domain in SES
SES → Verified Identities → Create Identity → Domain
Add the DNS records SES provides to your domain registrar
Requires a decided domain name — can defer if name is still pending
Step 6 — Wildcard DNS for CA Subdomains
Configure .muneemji.com → your load balancer / CDN from day one
CA subdomains ( caname.muneemji.com ) are created dynamically on CA
onboarding

## 0.2 Anthropic API Key
console.anthropic.com → API Keys → Create Key
Used for: CA website generation, invoice field extraction, statement
normalisation
Add to .env.local as ANTHROPIC_API_KEY

⚠️ Data compliance: documents sent to the API contain financial data. Enable

zero data retention if available on your plan. Disclose third-party AI processing
in your privacy policy.

## 0.3 Domain Setup
Primary domain: muneemji.com
CA subdomains: {ca-slug}.muneemji.com (dynamic, created at CA onboarding)
Custom CA domains: CA brings their own domain, points it at Muneem Ji
infrastructure via DNS

## 0.4 Checklist Before Phase 0

[ ] AWS account created
[ ] IAM user created with correct policies
[ ] Access Key ID and Secret Access Key saved securely
[ ] S3 buckets created in ap-south-1 (documents + websites)
[ ] SES production access requested (approval may be pending)
[ ] Own email verified in SES sandbox for testing
[ ] Anthropic API key obtained
[ ] muneemji.com domain purchased
[ ] Wildcard DNS configured (*.muneemji.com)
[ ] .env.local created from .env.example with all keys filled
in

# 1. Stack
Layer

Technology

Notes

Framework

Next.js 15 (App Router)

TypeScript strict mode throughout

Database

PostgreSQL via Drizzle
ORM

Local Docker in dev; AWS RDS at
Phase 6

Job Queue

BullMQ + Redis

Local Docker in dev; AWS ElastiCache
at Phase 6

Auth

NextAuth.js v5

JWT sessions; three session types
(CA, BO, Guest)

File Storage

AWS S3

Documents bucket + website assets
bucket

Website Assets

AWS S3 + CloudFront

Static site files for CA-generated
websites

Bank Statement
Parsing

pdfplumber (cached
scripts) + GPT-4o mini

Script cache per bank format; LLM
normalisation on every statement

Invoice OCR

Claude vision (Anthropic
API)

All invoices — text PDF and scanned —
processed via Claude

Email Delivery

AWS SES

Reminders, invites, enquiry
notifications

Layer

Technology

Notes

Virus Scan

ClamAV

Docker container in dev; ECS Fargate
sidecar at Phase 6

Hosting

AWS ECS Fargate

Phase 6 — ap-south-1 primary

Local Development Infrastructure
Run via Docker Compose alongside the Next.js dev server:
PostgreSQL
Redis
ClamAV
MinIO (local S3 substitute)

# 2. Core Architecture
muneemji.com (main domain — acquisition, directory, subscript
ion management)
│
└── caname.muneemji.com (CA subdomain — public websit
e + gated portal)
│
├── Public pages (CA website — unauthenticate
d)
└── Gated portal (CA login / BO login)
Browser (Next.js App Router)
│
▼
API Routes (Next.js) ──── Auth middleware (NextAuth.js v5)
│
├── Drizzle ORM ──────────── PostgreSQL
│
├── Storage (AWS S3) ────── Pre-signed upload URLs
│

└── BullMQ Jobs ──── Redis
│
├── website.queue

→ CA website generation

├── statement.queue

→ Bank statement parser

├── ocr.queue

→ Invoice OCR worker

├── match.queue

→ Transaction matching w

├── reminder.queue

→ Email reminder schedul

└── export.queue

→ Day book export worker

worker
worker

orker
er

Non-negotiable architectural rules:
# 1. All financial writes go through the Double Entry Engine ( lib/accounting/doubleentry-engine.ts ). No API route, no worker, no component writes to
journal_entries directly.
# 2. Files are never processed without a scan_status = 'clean' record. ClamAV is the
gate.
# 3. Every DB query on client data must include a ca_firm_id or client_org_id check.
Tenant isolation is mandatory.

# 3. Database Schema
All monetary values stored as BIGINT in smallest currency unit (paise for INR,
cents for CAD/EUR). Never DECIMAL, never FLOAT.

## 3.1 CA Firm and User Tables
-- CA firms (the paying entity; maps to one CA practice or so
lo CA)
CREATE TABLE ca_firms (
id
UUID PRIMARY KEY DEFAULT gen_random_uuid(),
name
TEXT NOT NULL,

email
country

TEXT NOT NULL UNIQUE,
CHAR(2) NOT NULL DEFAULT 'IN',

6-1 alpha-2: IN, CA, IE
currency
CHAR(3) NOT NULL DEFAULT 'INR',
subdomain_slug TEXT NOT NULL UNIQUE,
"rameshgupta"
custom_domain
TEXT UNIQUE,
"rameshgupta.com"

-- ISO 316
-- ISO 421
-- e.g.
-- e.g.

subscription_tier TEXT NOT NULL DEFAULT 'starter'
CHECK (subscription_tier IN ('starter',
'growth', 'pro', 'firm')),
is_verified
BOOLEAN NOT NULL DEFAULT false,
-- set tr
ue after CA verification
is_active
BOOLEAN NOT NULL DEFAULT true,
created_at
TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- CA users (admin = firm owner or partner; staff = associate
s, support staff)
CREATE TABLE ca_users (
id
UUID PRIMARY KEY DEFAULT gen_random_uuid(),
firm_id
UUID NOT NULL REFERENCES ca_firms(id),
email
name
role
f')),

TEXT NOT NULL UNIQUE,
TEXT NOT NULL,
TEXT NOT NULL CHECK (role IN ('admin', 'staf

password_hash TEXT NOT NULL,
created_at
TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- CA verification records (one per firm, V1 is manual)
CREATE TABLE ca_verifications (
id
UUID PRIMARY KEY DEFAULT gen_random_uuid(),
firm_id
E,

UUID NOT NULL REFERENCES ca_firms(id) UNIQU

country
-- India
icai_number
-- Canada
cpa_province

CHAR(2) NOT NULL,
TEXT,
TEXT,

-- e.g. 'ON', 'BC', 'AB'

cpa_number
TEXT,
-- Ireland
ie_membership_body TEXT, -- 'ICAI_IE', 'CPA_IE', 'ACCA', 'C
AI'
ie_membership_number TEXT,
submitted_at
TIMESTAMPTZ NOT NULL DEFAULT now(),
verified_at
TIMESTAMPTZ,
verified_by
ied
status

TEXT,

-- Muneem Ji staff member who verif

TEXT NOT NULL DEFAULT 'pending'
CHECK (status IN ('pending', 'verified',

'rejected'))
);

## 3.2 CA Website Table
-- CA websites (one per firm; generated by LLM at onboarding)
CREATE TABLE ca_websites (
id
UUID PRIMARY KEY DEFAULT gen_random_uuid(),
firm_id
UUID NOT NULL REFERENCES ca_firms(id) UNIQU
E,
-- Generated content
headline
TEXT,
tagline
TEXT,
about_text
services_json
n} objects

TEXT,
JSONB,

meta_titles
JSONB,
meta_descriptions JSONB,

-- array of {name, descriptio
-- page-level meta titles
-- page-level meta descriptio

ns

schema_markup
JSONB,
Service schema
-- Customisation
logo_s3_key
TEXT,

-- LocalBusiness + Accounting

colour_theme
TEXT DEFAULT 'default',
phone
TEXT,
whatsapp_number TEXT,
office_location TEXT,
languages_spoken TEXT[],
-- State
generation_status TEXT NOT NULL DEFAULT 'pending'
CHECK (generation_status IN ('pending',
'generating', 'ready', 'failed')),
is_live
BOOLEAN NOT NULL DEFAULT false,
-- only t
rue after CA verification
raw_llm_output JSONB,
gging
generated_at
TIMESTAMPTZ,
updated_at
created_at
);

-- full LLM response for debu

TIMESTAMPTZ NOT NULL DEFAULT now(),
TIMESTAMPTZ NOT NULL DEFAULT now()

## 3.3 Client Organisation Tables
-- Client organisations (businesses whose books are being kep
t)
CREATE TABLE client_orgs (
id
UUID PRIMARY KEY DEFAULT gen_random_uuid(),
firm_id
UUID NOT NULL REFERENCES ca_firms(id),
assigned_to
UUID REFERENCES ca_users(id),
-- team mem
ber assignment within firm
name
TEXT NOT NULL,
country
currency
tax_regime

CHAR(2) NOT NULL,
CHAR(3) NOT NULL,
TEXT NOT NULL CHECK (

tax_regime IN ('GST_INDIA', 'VAT_EU', 'GS
T_HST_CANADA')
),
tax_number
TEXT,
-- GSTIN (IN), VAT
no (IE), BN (CA)
acquisition_source TEXT NOT NULL DEFAULT 'ca_brought'
CHECK (acquisition_source IN ('ca_brou
ght', 'platform_discovered')),
is_active
BOOLEAN NOT NULL DEFAULT true,
created_at
TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Business owner contacts at client orgs
CREATE TABLE client_contacts (
id
(),
client_org_id
name
email
has_account
invite_token

UUID PRIMARY KEY DEFAULT gen_random_uuid
UUID NOT NULL REFERENCES client_orgs(id),
TEXT NOT NULL,
TEXT NOT NULL,
BOOLEAN NOT NULL DEFAULT false,
TEXT UNIQUE,

invite_expires_at TIMESTAMPTZ,
created_at
TIMESTAMPTZ NOT NULL DEFAULT now(),
UNIQUE (client_org_id, email)
);
-- Business owner accounts (created after accepting invite)
CREATE TABLE client_users (
id
contact_id
UNIQUE,

UUID PRIMARY KEY DEFAULT gen_random_uuid(),
UUID NOT NULL REFERENCES client_contacts(id)

client_org_id UUID NOT NULL REFERENCES client_orgs(id),
email
TEXT NOT NULL UNIQUE,
name
TEXT NOT NULL,
password_hash TEXT NOT NULL,

created_at
);

TIMESTAMPTZ NOT NULL DEFAULT now()

## 3.4 Independent Business Owner Tables
-- Independent BOs who use Muneem Ji without a CA
-- These users are not linked to any ca_firm or client_org
CREATE TABLE independent_bo_users (
id
UUID PRIMARY KEY DEFAULT gen_random_uuid(),
email
TEXT NOT NULL UNIQUE,
name
TEXT NOT NULL,
password_hash TEXT NOT NULL,
country
CHAR(2) NOT NULL DEFAULT 'IN',
currency
CHAR(3) NOT NULL DEFAULT 'INR',
-- Subscription
subscription_status TEXT NOT NULL DEFAULT 'active'
CHECK (subscription_status IN ('activ
e', 'inactive')),
-- Storage cap enforcement
document_count INTEGER NOT NULL DEFAULT 0,
storage_bytes
BIGINT NOT NULL DEFAULT 0,
-- Transition
linked_to_firm_id
UUID REFERENCES ca_firms(id),

-- set

when BO links with a CA
linked_client_org_id UUID REFERENCES client_orgs(id),
linked_at
TIMESTAMPTZ,
created_at
);

TIMESTAMPTZ NOT NULL DEFAULT now()

## 3.5 Lead Inbox Table
-- Enquiries submitted via CTA on CA public website
CREATE TABLE ca_enquiries (
id
firm_id

UUID PRIMARY KEY DEFAULT gen_random_uuid(),
UUID NOT NULL REFERENCES ca_firms(id),

name

TEXT NOT NULL,

email
TEXT,
phone
TEXT,
whatsapp_number TEXT,
service_interest TEXT,
message
TEXT,
-- Conversion tracking
status
TEXT NOT NULL DEFAULT 'new'
CHECK (status IN ('new', 'contacted', 'co
nverted', 'closed')),
converted_to_client_org_id UUID REFERENCES client_orgs(id),
submitted_at
TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at
);

TIMESTAMPTZ NOT NULL DEFAULT now()

## 3.6 Financial Tables
-- Bank statements (uploaded by business owner or CA)
CREATE TABLE bank_statements (
id
d(),
client_org_id
d),
uploaded_by_ca

UUID PRIMARY KEY DEFAULT gen_random_uui
UUID NOT NULL REFERENCES client_orgs(i
UUID REFERENCES ca_users(id),

uploaded_by_client UUID REFERENCES client_users(id),
-- Exactly one of the above must be non-null (enforced in a
pplication layer)
s3_key
TEXT NOT NULL,
filename
TEXT NOT NULL,
period_start
DATE NOT NULL,
period_end
DATE NOT NULL,
currency
status

CHAR(3) NOT NULL,
TEXT NOT NULL DEFAULT 'processing'
CHECK (status IN ('processing', 'pars

ed', 'failed')),

created_at
TIMESTAMPTZ NOT NULL DEFAULT now(),
CONSTRAINT uploaded_by_one_party CHECK (
(uploaded_by_ca IS NOT NULL AND uploaded_by_client IS NUL
L) OR
(uploaded_by_ca IS NULL AND uploaded_by_client IS NOT NUL
L)
)
);
-- Parsed transactions from a bank statement
CREATE TABLE bank_transactions (
id
UUID PRIMARY KEY DEFAULT gen_random_uuid
(),
statement_id
UUID NOT NULL REFERENCES bank_statements
(id),
client_org_id
UUID NOT NULL REFERENCES client_orgs(id),
transaction_date DATE NOT NULL,
amount_minor
BIGINT NOT NULL,
-- negative = debit (m
oney out), positive = credit (money in)
currency
CHAR(3) NOT NULL,
description
TEXT NOT NULL,
-- raw bank statement d
escription, never modified
match_status
TEXT NOT NULL DEFAULT 'unmatched'
CHECK (match_status IN ('unmatched', 'm
atched', 'flagged', 'out_of_scope')),
created_at
TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Documents submitted by business owners
CREATE TABLE documents (
id
UUID PRIMARY KEY DEFAULT gen_random_u
uid(),
client_org_id
UUID NOT NULL REFERENCES client_orgs
(id),
submitted_by_client
UUID REFERENCES client_users(id),
- null if guest submission

-

submitted_by_guest
UUID REFERENCES guest_tokens(id),
- null if logged-in submission
s3_key
TEXT NOT NULL,
filename
TEXT NOT NULL,
file_type
TEXT NOT NULL CHECK (file_type IN ('p
df', 'image')),
scan_status

TEXT NOT NULL DEFAULT 'pending'
CHECK (scan_status IN ('pending',
'clean', 'infected', 'error')),
ocr_status
TEXT NOT NULL DEFAULT 'pending'
CHECK (ocr_status IN ('pending', 'c
omplete', 'needs_review', 'failed')),
created_at
);

TIMESTAMPTZ NOT NULL DEFAULT now()

-- OCR-extracted fields from a document
CREATE TABLE document_extractions (
id
UUID PRIMARY KEY DEFAULT gen_random_uui
d(),
document_id
UNIQUE,
vendor_name
vendor_tax_number
(IE), etc.
invoice_number
invoice_date

UUID NOT NULL REFERENCES documents(id)
TEXT,
TEXT,
TEXT,
DATE,

base_amount_minor
tax_amount_minor
cgst_amount_minor
sgst_amount_minor
igst_amount_minor
tax_rate
total_amount_minor

BIGINT,
BIGINT,
BIGINT,
BIGINT,
BIGINT,
NUMERIC(5,2),
BIGINT,

currency
confidence
raw_json

CHAR(3),
NUMERIC(4,3),
JSONB,

-- GSTIN (IN), VAT no

-- 0.000 to 1.000

reviewed
reviewed_by
created_at
);

BOOLEAN NOT NULL DEFAULT false,
UUID REFERENCES ca_users(id),
TIMESTAMPTZ NOT NULL DEFAULT now()

-- Match between a transaction and a document
CREATE TABLE transaction_document_matches (
id
UUID PRIMARY KEY DEFAULT gen_random_uui
d(),
bank_transaction_id UUID NOT NULL REFERENCES bank_transacti
ons(id),
document_id
match_type
to', 'manual')),
confidence
matched_by
for auto matches
created_at

UUID NOT NULL REFERENCES documents(id),
TEXT NOT NULL CHECK (match_type IN ('au
NUMERIC(4,3),
UUID REFERENCES ca_users(id),

-- null

TIMESTAMPTZ NOT NULL DEFAULT now()

);
-- Journal entries — written ONLY by the Double Entry Engine
CREATE TABLE journal_entries (
id
UUID PRIMARY KEY DEFAULT gen_random_uuid
(),
client_org_id
UUID NOT NULL REFERENCES client_orgs(id),
transaction_id
entry_date
period
account_code
account_name
dr_cr
R')),
amount_minor
currency
narration
party_name

TEXT NOT NULL,
-- TXN-{YYYY}-{NNNNNN}
DATE NOT NULL,
TEXT NOT NULL,
-- YYYY-MM
TEXT NOT NULL,
TEXT NOT NULL,
TEXT NOT NULL CHECK (dr_cr IN ('DR', 'C
BIGINT NOT NULL,
CHAR(3) NOT NULL,
TEXT NOT NULL,
TEXT,

-- always positive

party_tax_number
invoice_ref
tax_amount_minor
tax_rate

TEXT,
TEXT,
BIGINT,
NUMERIC(5,2),

source_account
TEXT,
match_status
TEXT NOT NULL CHECK (match_status IN ('ma
tched', 'unmatched', 'flagged')),
document_id
UUID REFERENCES documents(id),
created_at
TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Reminder log
CREATE TABLE reminders (
id
UUID PRIMARY KEY DEFAULT gen_random_uuid(),
client_org_id
UUID NOT NULL REFERENCES client_orgs(id),
contact_id
UUID NOT NULL REFERENCES client_contacts(i
d),
reminder_type
TEXT NOT NULL CHECK (reminder_type IN ('aut
o_first', 'auto_followup', 'manual')),
sent_at
TIMESTAMPTZ NOT NULL DEFAULT now(),
transaction_ids UUID[] NOT NULL,
response_received BOOLEAN NOT NULL DEFAULT false,
response_at
TIMESTAMPTZ
);
-- Guest upload tokens
CREATE TABLE guest_tokens (
id
UUID PRIMARY KEY DEFAULT gen_random_uuid(),
client_org_id
UUID NOT NULL REFERENCES client_orgs(id),
token
TEXT NOT NULL UNIQUE,
expires_at
TIMESTAMPTZ,
-- null = persistent
URL
created_by
created_at
);

UUID NOT NULL REFERENCES ca_users(id),
TIMESTAMPTZ NOT NULL DEFAULT now()

-- Day book export records
CREATE TABLE exports (
id
UUID PRIMARY KEY DEFAULT gen_random_uuid(),
client_org_id
period_start
period_end
status

UUID NOT NULL REFERENCES client_orgs(id),
DATE NOT NULL,
DATE NOT NULL,
TEXT NOT NULL DEFAULT 'queued'
CHECK (status IN ('queued', 'generating',
'ready', 'failed')),
s3_key
TEXT,
had_unresolved_items BOOLEAN,
-- warn-only flag; ne
ver blocks export
generated_at
TIMESTAMPTZ,
created_by
UUID NOT NULL REFERENCES ca_users(id),
created_at
TIMESTAMPTZ NOT NULL DEFAULT now()
);

## 3.7 Chart of Accounts
CREATE TABLE chart_of_accounts (
id
UUID PRIMARY KEY DEFAULT gen_random_uuid(),
client_org_id UUID NOT NULL REFERENCES client_orgs(id),
code
TEXT NOT NULL,
name
TEXT NOT NULL,
account_type TEXT NOT NULL CHECK (
account_type IN ('ASSET', 'LIABILITY', 'EQU
ITY', 'REVENUE', 'EXPENSE')
tax_role
X_INPUT_IGST,

),
TEXT,

-- TAX_INPUT_CGST, TAX_INPUT_SGST, TA
-- TAX_OUTPUT, TAX_INPUT_RECOVERABLE

(IE/CA future)
is_system
created_at

BOOLEAN NOT NULL DEFAULT false,
TIMESTAMPTZ NOT NULL DEFAULT now(),

UNIQUE (client_org_id, code)
);

Seeded automatically on client org creation from a jurisdiction template ( GST_INDIA
in V1). India seed includes: Bank Account, Accounts Payable, Accounts
Receivable, Expense accounts, CGST Receivable, SGST Receivable, IGST
Receivable, CGST Payable, SGST Payable, IGST Payable, Suspense Account.

# 4. API Routes
All routes under /api/v1/ . All require authentication except guest upload and
public enquiry routes.
Three session types:
CASession

— for CA firm users (admin and staff)

ClientSession

— for business owner linked users

IndependentBOSession

— for unlinked independent BO users

Middleware resolves session type and sets context accordingly.

## 4.1 Auth — CA Firm/code
POST /api/v1/auth/ca/register

— CA firm signup + web

site generation trigger
POST /api/v1/auth/ca/login
POST /api/v1/auth/ca/logout`

## 4.2 Auth — Business Owner (Linked)
POST /api/v1/auth/client/accept-invite
e account from invite token
POST /api/v1/auth/client/login
POST /api/v1/auth/client/logout`

— set password, creat

## 4.3 Auth — Independent Business Owner

POST /api/v1/auth/bo/register
POST /api/v1/auth/bo/login
POST /api/v1/auth/bo/logout`

## 4.4 CA Website Management
GET
/api/v1/website
te + preview
POST
/api/v1/website/regenerate
eneration

— current website sta

PATCH /api/v1/website
ections (manual edits)
POST
/api/v1/website/publish
ble after is_verified = true)`

— update individual s

— trigger full AI reg

— go live (only calla

## 4.5 CA Verification
POST
/api/v1/verification
details
GET
/api/v1/verification
status`

— submit verification
— check verification

## 4.6 Lead Inbox (CA only)
GET
/api/v1/leads
for firm
PATCH /api/v1/leads/:id
cted, closed)
POST
/api/v1/leads/:id/convert
lient org (triggers invite flow)`

— list all enquiries
— update status (conta
— convert enquiry to c

## 4.7 Public Enquiry (unauthenticated)

POST
/api/v1/enquiry/:firm_slug
CA's public website`

— submit enquiry from

Fires both the WhatsApp wa.me redirect URL (returned in response for client-side
redirect) and creates the in-app record. No auth required.

## 4.8 Client Management (CA only)
GET
/api/v1/clients
ients for firm

— list all cl

POST
/api/v1/clients
nt org
GET
/api/v1/clients/:id
il + dashboard status
PATCH /api/v1/clients/:id
nt details (including assigned_to)
POST
/api/v1/clients/:id/contacts

— create clie
— client deta
— update clie
— add busines

s owner contact
POST
/api/v1/clients/:id/contacts/:cid/invite — send invite
email`

## 4.9 Team Management (CA admin only)
GET
m
POST
ember

/api/v1/team

— list CA users in fir

/api/v1/team/invite

— invite a new staff m

DELETE /api/v1/team/:uid

— remove team member`

## 4.10 Bank Statements (CA or linked BO)
POST
/api/v1/clients/:id/statements
pre-signed upload URL
POST
/api/v1/clients/:id/statements/confirm

— request S3
— confirm upl

oad, trigger parsing
GET
/api/v1/clients/:id/statements
— list statem
ents
GET
/api/v1/clients/:id/statements/:sid/transactions — pa
rsed transactions + match status`

BO accessing these routes: client_org_id resolved from session — can only
access their own org.

## 4.11 Documents (CA view)
GET
/api/v1/clients/:id/documents
— list all su
bmitted documents
PATCH /api/v1/clients/:id/documents/:did
— correct OCR
extraction fields
POST
/api/v1/clients/:id/documents/:did/match/:txn_id — ma
nually match
DELETE /api/v1/clients/:id/documents/:did/match — unmatch`

## 4.12 Documents (Linked BO view)
GET
/api/v1/my/pending
— pending transactions ne
eding documents
POST
/api/v1/my/documents/upload — request S3 pre-signed U
RL
POST
/api/v1/my/documents/confirm — confirm upload, trigger
OCR
GET

/api/v1/my/documents

— submission history`

## 4.13 Guest Upload (unauthenticated)
GET
/api/v1/guest/:token
pending items + client name
POST
/api/v1/guest/:token/upload
RL

— validate token, return
— request S3 pre-signed U

POST
OCR`

/api/v1/guest/:token/confirm — confirm upload, trigger

## 4.14 Independent BO (self-service)
GET
/api/v1/bo/statements
POST
/api/v1/bo/statements
forces storage cap before S3 URL)
POST
/api/v1/bo/statements/confirm

— list own statements
— upload statement (en
— confirm upload, trig

ger parsing
GET
/api/v1/bo/transactions
— parsed transactions
GET
/api/v1/bo/documents
— uploaded documents
POST
/api/v1/bo/documents/upload
— upload document
POST
/api/v1/bo/documents/confirm
POST
/api/v1/bo/link
— link with a CA on th
e platform (triggers subscription drop)
GET
/api/v1/bo/export
(ZIP download)`

— export all documents

Storage cap (500MB or 50 documents) is enforced at the upload route before
generating the pre-signed URL. If cap is exceeded, the route returns 402 with a
message directing the BO to link with a CA or upgrade.

## 4.15 Reminders (CA only)
GET

/api/v1/clients/:id/reminders

— reminder history

POST
/api/v1/clients/:id/reminders/send
eminder`

— trigger manual r

## 4.16 Export (CA only)
POST
/api/v1/clients/:id/export
k export (queued job)

— generate day boo

GET
/api/v1/clients/:id/export/:eid
wnload when ready`

— poll status / do

# 5. Job Queue Workers
## 5.1 website.queue — CA Website Generator
Trigger: CA firm registration complete
Job:
# 1. Fetch CA onboarding questionnaire data (name, services, location, languages,
specialisation)
# 2. Build generation prompt
# 3. Call Claude Sonnet API
# 4. Parse structured JSON response
# 5. Write to ca_websites record — generation_status = 'ready'
# 6. Website is not live until ca_firms.is_verified = true
Prompt structure: The LLM receives the questionnaire inputs and returns a JSON
object with headline , tagline , about_text , services (array), meta_titles ,
meta_descriptions , and schema_markup . It does not return HTML. The website template
is server-rendered by Next.js — the LLM supplies content only.
Regeneration: Same job, same prompt. Sections manually edited by the CA are
flagged in ca_websites . If is_live = true , the CA is warned before regeneration
proceeds.
Error handling: LLM failure → generation_status = 'failed' → notify CA via email.
Retry available on-demand via dashboard.

## 5.2 statement.queue — Bank Statement Parser
Trigger: Statement upload confirmed
Bank statements are always digital files (CSV or digitally-generated PDF).
Scanned bank statements are not accepted.

Adaptive Script Cache Architecture:
The parser uses a two-phase approach based on whether the bank format is
known.

Phase 1 — Format Detection and Extraction
Job:
# 1. Download file from S3
# 2. Detect file type: CSV or PDF
# 3. If CSV → skip to Phase 2 directly
# 4. If PDF → check bank_format_cache for a known extraction script for this bank
# 5. Cache hit → run cached pdfplumber Python script → produce clean row data
# 6. Cache miss → invoke Claude Opus with the full PDF content + script
generation prompt → receive a working pdfplumber script → cache it → run it
Bank format cache: keyed on a fingerprint of the bank header row (detected on
the first page of the PDF). Once a script is cached for HDFC, all future HDFC
statements across all customers use it at near-zero LLM cost.

Phase 2 — Normalisation (GPT-4o mini)
Every statement regardless of cache status passes through a normalisation step.
The LLM receives clean structured rows and returns ISO dates, signed amounts,
and currency codes.
{
"date": "YYYY-MM-DD",
"description": string,

// raw — never rephrase or transla

te
"amount": number,
ebit
"currency": string
}`

// positive = credit, negative = d
// ISO 4217

Continuing job:
# 7. Send normalised rows to bank_transactions — store raw description exactly
# 8. Update bank_statements.status = 'parsed'
# 9. Enqueue reminder.queue check for this client org
Error handling:
Extraction failure → status = 'failed' , alert CA
LLM malformed JSON → retry once, then status = 'failed'
Rows with null mandatory fields → write with nulls, flag for CA review — never
silently drop rows

## 5.3 ocr.queue — Invoice OCR
Trigger: Document uploaded and scan_status = 'clean'
Job:
# 1. Download file from S3
# 2. Pass directly to Claude vision API — all document types (text PDF, scanned
PDF, image)
# 3. Write extracted fields to document_extractions
# 4. Enqueue match.queue
The previous Textract split has been removed. Claude vision handles all invoice
types — it reasons about document content rather than doing character-level
OCR, making it more reliable across the real-world quality range of phonephotographed receipts and low-resolution scans.
LLM extraction prompt (GST_INDIA):
You are an invoice data extractor. Extract the following fields from this Indian GST invo
ice.
Return a JSON object only — no prose, no markdown fences.
{
"vendor_name": string | null,
"vendor_gstin": string | null,
"invoice_number": string | null,
"invoice_date": "YYYY-MM-DD" | null,
"base_amount": number | null,

"cgst_amount": number | null,
"sgst_amount": number | null,
"igst_amount": number | null,
"total_amount": number | null,
"currency": "INR",
"confidence": number

// 0.0 to 1.0

}
Return null for any field that cannot be determined. Do not guess. Lower confidence and r
eturn null if uncertain.`

Jurisdiction prompt variants: VAT_EU and GST_HST_CANADA prompts replace GST fields
with VAT/HST fields. The worker selects the prompt based on
client_orgs.tax_regime .

## 5.4 match.queue — Transaction Matching
Trigger: OCR complete for a document
Job:
# 1. Find unmatched bank transactions for same client_org_id
# 2. Score each candidate:
Amount match: exact ±2% → 0.5 points
Date proximity: same day → 0.3, within 7 days → 0.15
Vendor name fuzzy match against bank description → up to 0.2 points
# 3. Top score >0.85 → auto-match → write match record → enqueue Double
Entry Engine
# 4. Top score 0.5–0.85 → flag for CA review
# 5. Top score <0.5 → leave unmatched

## 5.5 reminder.queue — Automated Reminders
Trigger: Cron job, daily at 09:00 local time per client org country
Job:
# 1. For each active client org with unmatched transactions older than 3 days:
# 2. If no first reminder sent → send first reminder → log

# 3. If first reminder sent >48h ago, no response → send follow-up → log
# 4. If follow-up already sent → flag transactions for CA attention, stop chasing

## 5.6 export.queue — Day Book Export
Trigger: CA requests export
Job:
# 1. Fetch all journal entries for client org + date range
# 2. If unresolved items exist → set had_unresolved_items = true (warn-only, never
block)
# 3. Build Excel file (3 sheets: Journal, Unmatched Items, GST Summary)
# 4. Upload to S3
# 5. Update export record: status = 'ready' , s3_key , generated_at

# 6. Double Entry Engine
Location: lib/accounting/double-entry-engine.ts
This is the only file that writes to journal_entries . No exceptions.

Input
type EngineInput = {
clientOrgId: string;
bankTransaction: BankTransaction;
extraction: DocumentExtraction;
taxRegime: 'GST_INDIA' | 'VAT_EU' | 'GST_HST_CANADA';
chartOfAccounts: ChartOfAccount[];
};`

V1 Transaction Types (GST_INDIA)
Vendor expense — intra-state (CGST + SGST)

DR
DR

Expense Account
CGST Receivable

base_amount
cgst_amount

DR
CR

SGST Receivable
Bank Account

sgst_amount
total_amount`

Vendor expense — inter-state (IGST)
DR
DR

Expense Account
IGST Receivable

base_amount
igst_amount

CR

Bank Account

total_amount`

Unclassified debit (no matched document)
DR

Suspense Account

amount

CR Bank Account
-- flagged for CA review`

amount

Unclassified credit (no matched document)
DR
CR

Bank Account
Suspense Account

amount
amount

-- flagged for CA review`

Bank charge
DR

Bank Charges Expense

amount

CR

Bank Account

amount`

Validation
// All amounts as BigInt throughout
const totalDebits = entries
.filter(e => e.drCr === 'DR')
.reduce((sum, e) => sum + e.amountMinor, 0n);

const totalCredits = entries
.filter(e => e.drCr === 'CR')
.reduce((sum, e) => sum + e.amountMinor, 0n);
if (totalDebits !== totalCredits) {
throw new Error('UNBALANCED_ENTRY');

// Never catch and su

ppress this
}`

Jurisdiction Extension Points
The engine receives taxRegime and routes to the appropriate tax account selector.
V1 implements GST_INDIA . VAT_EU and GST_HST_CANADA add a new case in the switch —
existing logic is untouched.

# 7. File Upload Flow
# 1. Client (browser) requests pre-signed S3 URL from API
# 2. Browser uploads directly to S3 — never through Next.js server
# 3. Client calls /confirm endpoint
# 4. API enqueues ClamAV scan job
# 5. ClamAV result:
clean

→ update scan_status , enqueue OCR or parse job

infected

→ scan_status = 'infected' , delete from S3, notify CA

# 6. Files where scan_status != 'clean' are never served or processed
S3 Bucket Structure — Documents
muneem-documents/
{client_org_id}/
statements/
{statement_id}-{filename}
invoices/

{document_id}-{filename}
exports/
{export_id}-daybook.xlsx`

S3 Bucket Structure — Independent BO
muneem-documents/
bo/{independent_bo_user_id}/
statements/
{statement_id}-{filename}
documents/
{document_id}-{filename}`

# 8. CA Website Serving
CA websites are server-rendered by Next.js using subdomain routing. The
middleware resolves the subdomain from the Host header and fetches the
corresponding ca_websites record.
Request: GET https://rameshgupta.muneemji.com/
Middleware: extracts slug "rameshgupta"
queries ca_firms WHERE subdomain_slug = 'rameshgu
pta' AND is_verified = true
if not found or not live → 404
fetches ca_websites for that firm
renders website template with content`

Custom domain handling: When a CA has a custom_domain , the middleware also
checks incoming Host against ca_firms.custom_domain . The same rendering path
applies. SSL provisioning for custom domains is via AWS ACM with DNS validation
— this adds marginal infrastructure cost, reserved for Pro and Firm tier CAs.
Website template pages: Home, About, Services (one route per service), Contact.
Each is server-rendered with the CA's content data from ca_websites . No clientside content fetching — all content baked in at render time.

Login split: The CA's subdomain serves two login routes: /ca-login (resolves to
CASession ) and /client-login (resolves to ClientSession ). The portal after login is the
same Next.js app behind auth middleware.

# 9. Email Templates
Subject naming convention: Subject lines reference the CA's firm name, not
"Muneem Ji". The CA's brand is the visible sender for client-facing emails.
Reminder — First
Subject: Invoices needed — {ca_firm_name}
Hi {contact_name},
Your accountant needs the following invoices. Please upload them here:
{date}

{currency_symbol}{amount}

{bank_description}

{date}

{currency_symbol}{amount}

{bank_description}

Upload link (no login required): {upload_link}
— {ca_name}, {ca_firm_name}`

Reminder — Follow-up
Subject: Reminder: invoices still outstanding — {ca_firm_name}
Hi {contact_name},
We sent a reminder a couple of days ago. These items are still outstanding.
{same list}
Upload link: {upload_link}
If you have questions, contact {ca_email}.`

Invite — Business Owner
Subject: {ca_name} has invited you to their client portal

Hi {contact_name},
{ca_name} at {ca_firm_name} uses a secure portal to collect documents from clients.
You've been added as a contact for {client_org_name}. Use the link below to create your a
ccount and submit documents directly.
Create account: {invite_link}
This link expires in 7 days.`

Enquiry Notification — CA
Subject: New enquiry from {enquirer_name}
Hi {ca_name},
You have a new enquiry via your website.
Name: {name}
Contact: {email_or_phone}
Service interest: {service_interest}
Message: {message}
Log in to your dashboard to respond or convert to client.`

# 10. Security
Every protected API route: validate session → verify firm/org ownership →
proceed
BO routes: verify client_org_id matches session before any data access
Guest token routes: validate token exists, not expired, belongs to a real org
Independent BO routes: verify independent_bo_user_id matches session
Tenant isolation: every DB query on client data must include ca_firm_id or
client_org_id

S3 pre-signed URLs: 15-minute expiry, write-only for uploads, read-only for
downloads
All S3 buckets: private, no public access, no public bucket policies

ClamAV before any file processing. Skippable in local dev via
SKIP_VIRUS_SCAN=true

Passwords: bcrypt, minimum 12 rounds
Rate limiting: guest upload endpoints, auth endpoints, public enquiry endpoint
HTTPS only in production
Storage cap enforcement: enforced server-side at API route before pre-signed
URL generation — never trust client-reported file size

# 11. Environment Variables
# Database
DATABASE_URL=postgresql://...
# Redis
REDIS_URL=redis://localhost:6379
# Storage
AWS_REGION=ap-south-1
AWS_S3_DOCUMENTS_BUCKET=muneem-documents
AWS_S3_WEBSITES_BUCKET=muneem-websites
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
# For local MinIO:
S3_ENDPOINT=http://localhost:9000
# Auth
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
# Email
SES_FROM_EMAIL=noreply@muneemji.com
SEND_EMAILS=false
onsole

# set true in production; false logs to c

# AI
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
lisation

# website generation, invoice OCR
# GPT-4o mini for statement norma

# Dev flags
SKIP_VIRUS_SCAN=true

# set false in production

NODE_ENV=development`

# 12. Development Phases
The build is structured in two tracks that run sequentially, not in parallel.
Track 1 — Private Alpha (Phases 0–4) builds and validates the core engine: bank
statement parsing, invoice OCR, reconciliation, and double entry. Access is
restricted to 5–7 invited business owners from Bani's personal network. No CA
layer, no public access, no website platform. The engine is exposed directly to
BOs acting as their own "accountant" for the purpose of testing. Feedback from
this track determines what the engine needs before the full product is built around
it.
Track 2 — Full Product (Phases 5–10) builds the head and tail of the product as
designed in PRD v6 — the CA practice OS, website platform, directory, CA auth
layer, and public launch. This track begins only after Track 1 has validated the
engine with real users.
The schema is built for the full product from Phase 0 — no throwaway tables, no
migration debt. The Track 1 UI is minimal and internal; the same database and
workers underpin both tracks.

Track 1 — Private Alpha
Who uses it: 5–7 direct contacts of Bani who are business owners experiencing
the document collection problem. Invitation only. No public signup. No CA
intermediary — the BO interacts with the engine directly, playing both roles.

What they get: upload a bank statement → see parsed transactions → upload
invoices against flagged items → watch them reconcile → download a basic day
book. That is the complete scope of Track 1. Nothing else.
What they do not get: CA website, directory, CA auth, teams, subscription billing,
reminders, or any UI polish. The interface is functional, not finished.
Purpose: validate that the engine (parser, OCR, matching, double entry) works
correctly on real Indian bank statements and real invoices submitted by real
people — not synthetic test data. Surface the edge cases, format failures, and
reconciliation errors that only show up in production before any external user sees
the product.

Phase 0 — Foundation (Week 1)
Repo: Next.js 15, TypeScript strict, Drizzle, ESLint, Prettier, .env.example
Docker Compose: PostgreSQL, Redis, MinIO, ClamAV
Full schema from Section 3 created and migrations running (all tables,
including CA tables that will be empty in Track 1 — no migration debt later)
Alpha BO auth: email/password login for invited testers ( independent_bo_users
table, manually seeded — no self-signup)
Minimal dashboard skeleton: authenticated shell, no content yet
Session validation and tenant isolation helpers
Alpha access control: no public registration route exists. Tester accounts are
seeded directly into the database. ALPHA_MODE=true env flag disables any publicfacing signup routes.

Phase 1 — Bank Statement Upload + Parsing (Week 2)
Statement upload: S3 pre-signed URL flow
statement.queue

normalisation

worker: adaptive pdfplumber script cache + GPT-4o mini

Bank format cache table and script storage in S3
Transaction list view: date, amount, description, match status

Error states visible in UI (failed parse, null rows flagged)
CSV path tested alongside PDF path
Alpha feedback target: do parsed transactions match what the BO sees in their
actual bank statement? Are amounts, dates, and descriptions correct? Are any
rows dropped?

Phase 2 — Document Upload + OCR (Week 3)
Invoice upload flow from BO dashboard (S3 pre-signed URL)
ClamAV scan integration (feature-flagged, SKIP_VIRUS_SCAN=true in local dev)
ocr.queue

worker: Claude vision for all document types (PDF and image)

Extracted fields displayed per document: vendor, invoice number, date,
amounts, GST breakdown
Confidence score visible in UI (low confidence flagged for manual review)
Manual field correction by BO
Alpha feedback target: does OCR extract correct fields from the invoices these
specific BOs actually receive? What formats break? What confidence thresholds
are too low or too high?

Phase 3 — Matching + Double Entry Engine (Week 4)
match.queue

worker (auto-match + confidence scoring)

Match display in transaction list (matched, flagged, unmatched)
Manual match: BO selects a document for a transaction
Unmatch
Double Entry Engine: GST_INDIA tax rules
Journal entries written on confirmed match
Unmatched transactions flow to Suspense
Alpha feedback target: do auto-matches feel correct to the BO? How often does
it match the wrong invoice? How often does it miss an obvious match?

Phase 4 — Day Book Export + Alpha Hardening (Week 5)
export.queue

worker: 3-sheet Excel (Journal, Unmatched Items, GST Summary)

Export download from dashboard
had_unresolved_items

warning shown before download (never blocks)

Basic email reminders (SES in sandbox — BOs reminded to submit pending
invoices)
Error handling throughout: no unhandled rejections, failed jobs visible in
dashboard
Zod validation on all API routes used in Track 1
Rate limiting on upload endpoints
Alpha feedback target: is the day book output useful? Does it tell the BO
something meaningful about their finances? Are the unmatched items a minority
or a majority?
Track 1 exit criterion: the engine has processed at least one full month of real
statements for at least 3 BOs, produced a day book, and the feedback has been
reviewed. Known engine issues are documented and triaged. Bani has confidence
the core works as intended.

Track 2 — Full Product Build
Begins after Track 1 exit criterion is met. The schema is already in place. Workers
already exist. Track 2 builds the CA layer, the website platform, and everything
needed for public launch on top of the validated engine.

Phase 5 — CA Auth + Client Management (Week 6)
CA firm registration and login ( ca_users , ca_firms )
Add client org flow (country/currency/tax_regime picker)
Team member invite and assignment within firm
Add BO contact + send invite email
BO invite acceptance (set password, create account via client_users )

BO login on CA subdomain ( ClientSession )
Subdomain routing middleware (resolves slug from Host header)

Phase 6 — CA Website + Verification (Week 7)
CA onboarding questionnaire
website.queue

worker: CA website generation via Claude Sonnet

CA website template: Home, About, Services, Contact pages (serverrendered)
CA website preview (visible only to CA before verification)
CA verification submission form
Website goes live on is_verified = true
Website content editor: inline section editing, logo upload, colour theme

Phase 7 — Lead Inbox + Directory (Week 8)
Public enquiry endpoint ( POST /api/v1/enquiry/:firm_slug , unauthenticated)
WhatsApp wa.me redirect URL returned in enquiry response
In-app lead inbox in CA dashboard
Lead status management (new → contacted → converted / closed)
Lead → client org conversion (triggers standard invite flow)
muneemji.com/find-a-ca

directory: browseable by country, city, service type

Client acquisition source tracking on client_orgs

Phase 8 — Independent BO Path (Week 9)
Independent BO self-signup (public, independent_bo_users )
BO statement upload and parsing (same workers, different S3 path)
BO document upload with storage cap enforcement (500MB / 50 documents)
BO transaction view
BO → CA link flow (subscription drop, document history port to client_orgs )

BO document export (ZIP download)

Phase 9 — Reminders + Full Export (Week 10)
reminder.queue

worker: cron at 09:00 IST, first + follow-up logic

Reminder emails sent under CA firm name (not "Muneem Ji")
Reminder log and manual trigger in CA dashboard
Full export for CA-managed clients (Journal, Unmatched, GST Summary)
Guest upload token generation and guest upload flow

Phase 10 — Pre-Launch Hardening (Week 11)
Zod validation on all remaining API routes
Rate limiting: guest upload, auth, public enquiry, BO signup
Structured logging throughout
Custom domain SSL provisioning (ACM — Pro and Firm tier CAs only)
Subscription tier enforcement (client count limits per tier)
UI polish pass: first external CA will see this; it must be presentable
Deploy to ECS Fargate (ap-south-1)
Smoke test full CA onboarding flow end-to-end on production

# 13. CLAUDE.md Content (place at repository root)
# Muneem Ji — Developer Guide for Claude Code
## What This Product Does
Muneem Ji is a CA practice operating system. It solves two pr
oblems for CAs simultaneously:
# 1. Digital presence — every CA gets an AI-generated professio
nal website under their own brand
# 2. Document collection — CAs collect bank statements and invo

ices from clients; the system matches them and produces a day
book
Muneem Ji is not bookkeeping software. The day book is a bypr
oduct of a solved coordination problem.
## Product Layers
**muneemji.com** — main domain. CA acquisition, directory, su
bscription management.
**caname.muneemji.com** — CA subdomain. Public CA website (un
authenticated) + gated client portal (CA login / BO login).
## User Types
- **CA users** — the paying entity. Admin or staff role withi
n a ca_firm.
- **Client users** (linked BO) — invited by a CA. Access via
client login on the CA subdomain.
- **Independent BO users** — no CA link. Pay ₹199/month. Stor
age-capped.
- **Guest** — unauthenticated upload via token link.
## Tech Stack
- Next.js 15 (App Router), TypeScript strict
- PostgreSQL + Drizzle ORM
- BullMQ + Redis (job queues)
- NextAuth.js v5 (JWT sessions — three session types: CASessi
on, ClientSession, IndependentBOSession)
- AWS S3 / MinIO (document storage + website asset storage)
- Claude Sonnet (CA website generation via Anthropic API)
- Claude vision (invoice OCR for all document types)
- GPT-4o mini (bank statement normalisation after structural
extraction)
- pdfplumber (Python — cached scripts for bank statement stru

ctural extraction)
- ClamAV (virus scanning)
- AWS SES (email)
## Non-Negotiable Financial Rules
# 1. **MONEY IS BIGINT.**
All monetary values as BIGINT in smallest currency unit (p
aise for INR, cents for CAD/EUR).
Never DECIMAL, FLOAT, or JS number for money. Ever.
# 2. **DOUBLE ENTRY ENGINE IS THE SOLE JOURNAL WRITER.**
Only `lib/accounting/double-entry-engine.ts` writes to `jo
urnal_entries`.
API routes do not write journal entries. Workers do not wr
ite journal entries.
Components do not write journal entries.
# 3. **EVERY ENTRY MUST BALANCE.**
The engine throws `UNBALANCED_ENTRY` if debits ≠ credits.
Never catch and suppress this.
# 4. **SCAN BEFORE PROCESS.**
Never run OCR on a file where `scan_status != 'clean'`.
# 5. **TAX MUST BE SPLIT.**
For India GST: CGST, SGST, IGST are separate journal entry
lines. Never collapse into base amount.
# 6. **EXPORT IS WARN-ONLY.**
`had_unresolved_items` is a warning flag. It never blocks
export generation. Never add a hard block.
## Security Rules
# 7. **VALIDATE SESSION FIRST.**

Every protected route checks auth before touching any dat
a.
# 8. **TENANT ISOLATION.**
Every DB query on client data must include `ca_firm_id` or
`client_org_id`.
A CA user must never access data belonging to another fir
m.
# 9. **PRE-SIGNED URLS FOR UPLOADS.**
Files upload directly from browser to S3. They never pass
through Next.js.
# 10. **STORAGE CAP IS SERVER-ENFORCED.**
Independent BO storage cap (500MB or 50 documents) is che
cked at the API route before pre-signing.
Never trust client-reported file size.
## V1 Scope Guards
Do NOT implement in V1:
- GST filing or return generation
- Ireland VAT logic (scaffold fields only)
- Canada GST/HST logic (scaffold fields only)
- Multi-currency transactions
- Tally / Xero / QuickBooks integration
- Mobile app
- Automated subscription billing
- Payroll
- Blog AI tool
- WhatsApp Business API (use wa.me redirect only)
- Programmatic CA verification (manual staff review in V1)
## Agent Boundaries
- **Schema Agent**: owns `db/schema/` and `db/migrations/` —

no business logic
- **API Agent**: owns `app/api/**` — uses Drizzle, enqueues j
obs, returns HTTP
- **Worker Agent**: owns `workers/**` — reads/writes DB, no H
TTP
- **Engine Agent**: owns `lib/accounting/**` — pure function
s, no HTTP, no queue
- **Frontend Agent**: owns `app/(dashboard)/**` and `componen
ts/**` — calls API routes only, no direct DB
- **Website Agent**: owns `app/(website)/**` — subdomain-awar
e rendering, reads ca_websites, no financial logic
## Common Mistakes to Avoid
- Using `number` type for money → use `bigint`
- Writing journal entries in an API route → use the engine
- Querying client data without `ca_firm_id` → tenant isolatio
n violation
- Processing files before ClamAV returns clean → security vio
lation
- Collapsing CGST + SGST → must be separate columns and separ
ate journal lines
- Using `new Date()` for financial dates → use the explicit D
ATE from the transaction
- Blocking export on unresolved items → `had_unresolved_items
` is warn-only, never a block
- Making the CA website live before `is_verified = true` → we
bsite must be gated until verified
- Allowing BO to exceed storage cap → enforce at API layer be
fore pre-sign`

# 14. Unit Economics Reference
All figures are estimates based on published API pricing as of Q1 2026. Validate
against real usage within 90 days of launch.

Bank Statement Parsing
Scenario

Cost

Notes

Cache miss (Claude Opus — script
generation)

~$0.21

Platform cost, one-time per bank
format

Cache hit (pdfplumber execution)

~$0.001

Compute only

GPT-4o mini normalisation (every
statement)

~$0.001

~50 txns, ~2,500 input + ~1,200
output tokens

S3 storage per statement (2MB, 7yr
~$0.003
retention)
Total per statement (mature,
cache hit)

~$0.005

At Growth tier (20 clients × 4 statements/month = 80 statements): parsing cost
~$0.40/month per CA. Revenue at Growth tier ~$35 USD/month. Parsing is under
2% of revenue at maturity.

CA Website Generation
Cost
Claude Sonnet input (1,500 tokens @ $3/M)

$0.0045

Claude Sonnet output (3,000 tokens @ $15/M) $0.045
Total per generation

~$0.05

One-time at signup plus occasional refresh. Under 0.5% of first month revenue at
any paid tier.

Storage per CA (Growth tier, year one)
20 clients × 50 documents/month × 500KB = 500MB new documents/month
20 clients × 4 statements × 2MB = 160MB statements/month
S3 Standard: $0.023/GB → ~$0.015/month addition
Cumulative after 12 months: ~8GB → ~$0.18/month
Storage cost is under $0.25/month per CA at Growth through year one. Immaterial
relative to revenue.

Independent BO Tier
Value
Revenue

₹199/month (~$2.40 USD)

Storage cap

500MB or 50 documents

Max storage cost at cap

~$0.012/month

GPT-4o mini parsing (2 statements/month) ~$0.002/month
Total marginal cost per BO

~$0.015/month

Gross margin

~99%

⚠️ Monitor BO-to-CA ratio. If unlinked BOs exceed 5× the CA count, review the
pricing floor and storage cap.

Document version 2.0. Supersedes Technical Specification v1.4 in full. All sections
have been updated to reflect PRD v6.0.

