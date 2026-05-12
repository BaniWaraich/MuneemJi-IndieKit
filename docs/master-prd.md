# Master PRD (Muneem Ji v6)

> Extracted from `docs/archive/muneem-ji-prd-v2.pdf` on 2026-05-02 via pdftotext.
> Treat this Markdown copy as canonical going forward; the PDF is the historical render.

# 1. Vision and North Star
Muneem Ji is a CA practice operating system. It gives every practicing accountant
three things simultaneously: a professional website under their own brand, a client
document collection and management platform, and a clean day book as output —
all integrated, all under one roof.
The product operates on two layers.
The street is Muneem Ji's infrastructure, domain, back-end engine, and platform
foundation. It is invisible to end users. It is what makes everything else possible.
The plot is what each CA gets: a branded website, a client portal, and a practice
management dashboard — all appearing to belong entirely to that CA. From the
outside, a business owner sees their CA's professional presence. From the inside,
Muneem Ji is running everything.
Muneem Ji is not bookkeeping software. It is the infrastructure layer that sits
before bookkeeping begins — solving the document collection problem that exists
before any ledger can be written. The day book is a byproduct of a solved
coordination problem, not the primary product.
The longer game: every document processed, every transaction matched, every
vendor and customer relationship mapped builds a data foundation that makes
financial intelligence possible. V1 earns the right to everything that follows.

# 2. The Problems Being Solved
For the CA
CAs in India, Canada, and Ireland face two distinct problems that Muneem Ji
solves together.

Problem one — no digital presence. The majority of practicing CAs have no
website. They exist on directory listings with dozens of competitors and no way to
differentiate. They cannot run ads, cannot rank on Google, cannot project
professionalism to prospective clients. Building a website requires time, technical
knowledge, and ongoing maintenance that most small CA practices do not have.
Problem two — document collection chaos. Every month, CAs spend
disproportionate time on one low-value task: chasing clients for invoices, bank
statements, and receipts before the books can be closed. Clients are slow, send
documents in the wrong format, forget entirely, or send duplicates. This happens
every month, for every client, with no structural solution.
These two problems have never been solved together. Muneem Ji solves both in
one product.

For the Business Owner
Business owners already do the work of collecting and sending financial
documents to their CA. The problem is the handoff — email attachments,
WhatsApp forwards, missed messages, duplicate sends. They have no visibility
into whether what they sent was received, matched, or sufficient.
Business owners who find a CA through Muneem Ji's directory get a more
trustworthy experience than finding someone on a generic listing — they land on a
professional website and enter a structured portal. Business owners who already
have a CA get a cleaner, more organised way to submit what their CA needs.
Business owners without a CA can also use Muneem Ji independently to organise
their documents and get ready for whenever a CA enters the picture.

# 3. Who Uses This Product
## 3.1 Primary User — The CA / Accountant
A practicing CA or accountant managing clients in India, Canada, or Ireland. They
may be a solo practitioner or part of a small firm with multiple partners and staff.
They pay for the product. They onboard clients. They receive the final output.
They use Muneem Ji for two distinct purposes: growing their practice (through the
website and directory) and managing their existing clients (through the document

collection and day book platform).

## 3.2 Secondary User — The Business Owner (Linked Client)
An employee, owner, or office manager at a client organisation. They are invited
by their CA or they find the CA through Muneem Ji's directory and initiate contact.
They upload bank statements, submit invoices when prompted, and can see their
own submission status. They do not pay — the CA's subscription covers their
access.

## 3.3 Independent Business Owner (Unlinked)
A business owner who uses Muneem Ji without a CA on the platform. They pay
₹199/month (or CAD/EUR equivalent) for document organisation, transaction
visibility, and a parser tool that structures their financial records. They do not
receive a day book. When they link with a CA on the platform, their subscription
drops to zero — the CA's plan absorbs them.

⚠️ Economics note: The ₹199 price point must cover marginal storage and AI
parsing costs per BO. Unit economics for this tier require validation once real
usage patterns are known. See Section 21.

## 3.4 Prospective Client (Pre-onboarding)
A business owner who has found a CA's website through search or the Muneem Ji
directory but has not yet become a client. They interact with the CA's publicfacing website and submit an enquiry through the CTA. This is a distinct user state
with its own flow.

# 4. Target Markets
Muneem Ji launches across three jurisdictions. The back-end engine is
jurisdiction-aware from day one — tax logic, terminology, verification, and
compliance are configured per country.

India
Full GST compliance stack active from launch. ICAI-verified CA profiles. Indian
banking integrations. INR pricing. Hindi and English interface. Terminology: GSTIN,
GST, ITR, challan, CGST, SGST, IGST.

Canada
CPA-verified profiles (provincial body declared at onboarding). CAD pricing.
English and French interface. Terminology: T2 returns, HST, GST, CRA, provincial
tax. Payment gateways: Stripe, Moneris, Helcim. Banking: RBC, TD, Scotiabank,
BMO, CIBC.
Note: Canadian banks will reach the parser cache at a later stage than Indian
banks given the market entry sequencing. Cache miss costs will be proportionally
higher in Canada during early months. See Section 21.

Ireland
Multi-body verification (ICAI Ireland, CPA Ireland, ACCA, Chartered Accountants
Ireland — CA declares membership body). EUR pricing. English interface.
Terminology: VAT3, Revenue Commissioners, corporation tax, VAT.

# 5. The Two Entry Points
Muneem Ji has two distinct primary audiences and the homepage reflects this
with a clear split entry point at the hero level.
Entry point one — "Are you a CA?" Routes into the CA acquisition funnel.
Highlights the website offer, the practice platform, and the client management
tools. Primary CTA is to get started and claim their website.
Entry point two — "Are you a business owner?" Routes into either the directory
(find a CA) or the independent BO onboarding flow (get your documents in order).
Primary CTA is to find a CA or get started independently. The independent path
surfaces the incentive clearly: link with a CA on the platform and your ₹199/month
drops to zero.
Below the fold, the homepage serves both audiences — how the platform works,
the directory preview, and trust signals.
After onboarding, the CA operates entirely from their own subdomain.
muneemji.com is the acquisition and onboarding funnel only. Subscription
management is the one exception — it lives on muneemji.com for security and
consistency.

# 6. The CA Website
## 6.1 What the Website Is
Every CA on Muneem Ji gets a professional white-labelled website. This is not a
landing page or a profile card. It is a complete, AI-generated website under the
CA's own brand — their name, their colours, their services, their city — hosted on
their own subdomain.
The website serves two functions simultaneously: it is a public marketing surface
for the CA to acquire new clients, and it is the front door to the gated client portal
where existing clients manage their documents.
The CA is responsible for their own SEO efforts. Muneem Ji provides the website
infrastructure and an SEO starter guide for CAs who are new to digital presence.
Muneem Ji does not manage, guarantee, or run SEO on behalf of individual CA
websites.

## 6.2 URL Structure
Default: caname.muneemji.com — subdomain of Muneem Ji's root domain.
The CA's website is a subdomain. It does not inherit domain authority from
muneemji.com. Subdomains are treated as independent entities by search
engines. The CA builds their own SEO standing from their own subdomain.
No subdirectory-to-subdomain redirect is implemented. Redirects between
subdirectory and subdomain create unnecessary crawler complexity and may be
flagged by search engines. The subdomain is the canonical URL and the only URL.
Custom domain (CA brings their own): CA's own domain ( rameshgupta.com ) points
directly to their Muneem Ji-hosted website via DNS. The experience is entirely on
the CA's own domain. Muneem Ji infrastructure serves it.

⚠️ Economics note: Custom domain SSL provisioning and DNS management add
marginal infrastructure cost per CA. To be factored into tier pricing.

## 6.3 Website Generation
Websites are generated by an LLM pipeline (Claude Sonnet) from the CA's
onboarding questionnaire inputs. The output is original content per CA —
reflecting their voice, location, and specialisation.

The generation pipeline produces: home page headline and description, about
section, services descriptions, meta titles and descriptions for all pages, and
schema markup (LocalBusiness, AccountingService, Person).
After generation, the CA sees a preview of their website before it goes live. They
can edit any section through a simple text editor — editable fields per section, not
a full page builder. Their edits are preserved.
The website does not go live until CA verification is complete (see Section 9).

⚠️ Economics note: Website generation is a one-time Sonnet API call per CA at

signup, plus incremental calls for content refresh requests. Cost is low relative to
CA LTV but must be tracked. See Section 21.

## 6.4 Website Pages
Public pages (visible to anyone):
Home — CA's headline, value proposition, primary CTA
About — CA's background, qualifications, practice philosophy, team
Services — per-service pages generated from selected services at
onboarding
Contact — contact form, phone, email, WhatsApp link, office location
Blog — optional, off by default. CA can enable and write posts via the AIassisted blog tool (implementation deferred; tool to be designed when core
product is stable)
Gated pages (authenticated users only):
CA Login — practice management dashboard
Client Login — document submission portal

## 6.5 Login Split on the CA Subdomain
The CA's subdomain serves two authenticated audiences via two distinct login
routes.
CA Login — for the CA and their team members. Authenticates into the practice
management dashboard: client list, document collection status, day book export,
website management, lead inbox, team management.

Client Login — for business owners who are existing clients of that CA.
Authenticates into the document submission portal: upload bank statements,
submit invoices, view submission status, download their own documents.
A prospective client who has not yet been onboarded uses neither login — they
interact with the public pages only and submit an enquiry via the CTA.

## 6.6 Website Content Management
CAs manage their website through a dedicated section of their dashboard. They
can: edit any text section, update their service list, change their logo and colour
theme, upload a new profile photo, update contact details, and enable or disable
the blog.
A content regeneration option exists — the CA can request a full AI regeneration
of their website content at any time. Manually edited sections are flagged and the
CA is asked whether to preserve them or regenerate.
Muneem Ji provides an SEO starter guide to CAs who want to improve their
search ranking. The guide covers basic on-page SEO, Google Business Profile
setup, and local citation building. Execution remains entirely with the CA.

# 7. The Muneem Ji Directory
muneemji.com/find-a-ca

CAs on the platform.

is a publicly accessible, searchable directory of all verified

Browseable by: country, state/province, city, service type, language spoken.
Each directory listing shows: CA name, firm name, city, services offered,
languages spoken, years of practice, and a link to their full profile website.
The directory is Muneem Ji's primary traffic driver for business owner acquisition.
A BO searching for a CA in their city lands on the directory, finds a verified CA,
and lands on that CA's professional website. The directory page itself is SEOoptimised and maintained by Muneem Ji as part of the main domain.
Business owners who find a CA through the directory and are subsequently
onboarded are recorded as platform-discovered clients. This acquisition source
field is tracked from day one for future analysis. See Section 11.

# 8. The Client Portal
## 8.1 Interface
The client portal is accessed via the "Client Login" route on the CA's website. The
portal carries Muneem Ji's clean interface. The CA's logo appears in the portal
header. The URL remains on the CA's subdomain. The experience is coherent —
not a jarring transition into a visibly third-party application, but Muneem Ji's own
design rather than a white-labelled clone of the CA's public site.

## 8.2 Business Owner Portal Features
Document submission dashboard — current month status, what has been
submitted, what is still needed
Bank statement upload — direct upload or email-in
Invoice submission — submit individual invoices against flagged transactions
Submission history — all past uploads across all periods
Monthly summary — plain-English view of their financial activity for the period
Document export — BO can download their own uploaded documents at any
time, including during a CA's grace period

## 8.3 The Core Collection Loop
CA adds client → invites BO →
BO uploads bank statement →
System parses statement, identifies transactions →
System flags transactions needing invoices →
System sends reminders to BO for missing documents →
BO submits invoices →
System OCRs and matches invoices to transactions →
CA reviews matched and unmatched items →
CA exports day book

# 9. CA Verification
No CA profile goes live until verified. Verification is manual for V1, with
programmatic verification as a future automation.

Process: CA submits membership body and membership number at onboarding.
Muneem Ji team verifies against the relevant public directory within 24–48 hours.
Profile activates upon verification. CA is notified by email and in-app notification.
India: ICAI membership number verified against ICAI public member search.
Canada: CPA provincial body declared at onboarding (CPA Ontario, CPA BC, CPA
Alberta etc.). Province is a required field. Verified against the relevant provincial
body directory.
Ireland: CA declares membership body (ICAI Ireland, CPA Ireland, ACCA, or
Chartered Accountants Ireland). Verified against the declared body's public
directory.
Unverified profiles can be set up and previewed but are not publicly accessible
and do not appear in the directory.

# 10. Enquiry Management
When a prospective client submits the "Talk to CA" CTA on a CA's public website:
Instant WhatsApp redirect — the CTA generates a wa.me link with a pre-filled
message. The prospective client's WhatsApp opens immediately. No API cost. No
friction.
In-app notification — regardless of WhatsApp, an in-app notification fires in the
CA's dashboard. The enquiry is logged in a lead inbox.
Lead inbox — the CA sees all enquiries with name, contact detail, service interest,
and timestamp. One-click action converts an enquiry to a client, triggering the
standard invite flow.
Channel configuration — CAs can configure additional notification channels
(email) in settings. WhatsApp redirect and in-app notification are always active.

# 11. Client Acquisition Source Tracking
Every client carries an acquisition source field from the moment of creation.
CA-brought — the CA added this client from their existing practice outside the
platform.

Platform-discovered — the client found the CA through Muneem Ji's directory or
the CA's website, submitted an enquiry, and was converted through the lead
inbox.
This field is recorded, retained, and never deleted. No commercial action is taken
at launch. The data exists for future decisions about pricing, referral programs, or
marketplace features.

# 12. Branding and White-Label
Lower Tiers
"Powered by Muneem Ji" appears in the footer of the CA's public website. Subtle,
one line. This is Muneem Ji's primary brand awareness mechanism — every CA
site on lower tiers is a passive brand touchpoint for prospective clients browsing
the web.

Higher Tiers (White-Label)
No Muneem Ji mention anywhere on the CA's public-facing website. The CA's
brand is completely clean. White-label is a genuine tier upgrade incentive — a
meaningful professional distinction for CAs protective of their brand
independence.
White-label does not affect the authenticated portal layer, which always carries
Muneem Ji's interface.

# 13. Teams Within a CA Firm
A CA firm account can have multiple members — partners, associates, support
staff. Within one organisation, clients can be assigned to specific team members.
A team member sees and manages only the clients assigned to them unless they
have firm-level admin access.
This supports the multi-partner firm model without requiring separate Muneem Ji
accounts per partner. The firm has one website, one subscription, one subdomain
— but internal client ownership is structured by team assignment.

# 14. Pricing Structure
Tiered by client count. Website included at all tiers. Numbers are indicative and
will be refined as the product evolves and unit economics are validated.
Tier

Monthly Price

Client Limit

Branding

Notable Features

Starter

₹999 / $15 CAD
/ €12

5 clients

Powered by
Muneem Ji

Core platform, AI
website

Growth

₹2,499 / $35
CAD / €28

20 clients

Powered by
Muneem Ji

Full content
customisation

Pro

₹4,999 / $65
CAD / €55

50 clients

Powered by
Muneem Ji

Custom domain,
priority support

Firm

₹9,999 / $130
CAD / €110

Unlimited

White-label
available

Multi-team, firm
analytics

Independent BO tier: ₹199/month (CAD/EUR equivalent). Includes document
upload, AI parsing, transaction visibility, and storage up to 500MB or 50
documents, whichever is reached first. Drops to zero when linked with a CA on the
platform. Clear incentive communicated at signup: "Find a CA on Muneem Ji and
your subscription is free."

⚠️ Economics note: All pricing above is directional. Full unit economics validation
required before launch. See Section 21.

# 15. Business Owner Direct Path
Business owners without a CA can join Muneem Ji independently.
What they get: document upload and organisation, AI-powered bank statement
parsing, transaction visibility, and a structured financial record. They do not
receive a day book — that requires a CA.
The value proposition: "Get your documents in order before you find a CA. When
you do, everything is already organised and waiting." This is a readiness product
— it reduces the activation energy of starting with a CA.
Storage cap: 500MB or 50 documents, whichever is reached first. Beyond this
cap, the BO must either upgrade (pricing TBD) or link with a CA on the platform
whose subscription covers their storage.

When BO links with a CA: if the CA is on Muneem Ji, the BO's document history
ports to the new CA relationship seamlessly. The BO's subscription drops to zero.
The CA's client slot is consumed.
When BO links with a CA outside the platform: the BO can export all their
documents. Their Muneem Ji record remains theirs but they continue paying
₹199/month if they wish to keep using the platform independently.

⚠️ Economics note: ₹199/month must cover marginal AI parsing cost, storage

cost, and a proportional share of infrastructure overhead per BO. If the number of
unlinked BOs significantly outgrows the CA base, the cost structure becomes
unfavourable. Monitoring the BO-to-CA ratio is an operational metric from day
one. If the ratio exceeds a threshold to be defined, the BO price point or storage
cap must be revisited. See Section 21.

# 16. Exit Policy and Data Ownership
CA Exit
Non-renewal: after subscription lapses, a grace period applies during which the
website remains live and the platform remains accessible. After the grace period,
the website is taken offline, the account is suspended, and the CA's subdomain
becomes inactive.
Data: all CA data is retained by Muneem Ji in a suspended state. The CA can
request a full data export at any time.
The website: the website is a Muneem Ji asset hosted on Muneem Ji
infrastructure. The CA does not own the website and cannot take it upon leaving.
If a CA has a custom domain pointed at Muneem Ji, they retain their domain and
can point it elsewhere — the website content and infrastructure stays with
Muneem Ji.

Business Owner Data Independence
Business owners retain access to download their own uploaded documents at any
time — including during a CA's grace period. Bank statements, invoices, and
source documents belong to the BO. They have tax and compliance significance
that exists independently of any CA relationship.

The CA's outputs (day books, reconciliation reports) are the CA's work product
and are governed by the CA's account status.
If a BO's CA leaves the platform and the BO finds a new CA through Muneem Ji's
directory, their document history ports to the new CA relationship. The BO's
continuity of record is preserved.

# 17. The Muneem Ji Main Domain
muneemji.com

serves as the root domain and the public face of the platform.

Homepage: split entry point — CA acquisition funnel and BO entry point (directory
or independent onboarding). Marketing content for both audiences below the fold.
Directory: muneemji.com/find-a-ca — browseable, searchable, filterable. SEOoptimised by Muneem Ji.
CA signup and onboarding: the primary CA acquisition funnel. Ads targeting CAs
drive here.
Subscription management: all billing, plan changes, and payment details
managed here for all users.
Blog (future phase): content targeting both CAs and BOs. AI-assisted tool to be
designed when core product is stable. Deferred.

# 18. What Muneem Ji Is Not
Not a bookkeeping tool. Muneem Ji does not replace Zoho Books, Tally, or any
ledger software. It solves the document collection problem that exists before
those tools become relevant.
Not a marketplace with ratings. There are no reviews, ratings, or competitive
ranking signals between CAs. The directory is a discovery tool, not a comparison
engine.
Not an SEO agency for CAs. Muneem Ji provides the website and an SEO starter
guide. Rankings are the CA's responsibility.
Not an accounting compliance tool. Muneem Ji does not file GST returns,
generate TDS certificates, or produce statutory reports. The day book is output
for the CA to use in their preferred compliance tool.

Not a global product at launch. India, Canada, and Ireland are the launch markets.

# 19. Document Ingestion, Parsing, Security, Matching,
Double Entry Engine, Dashboard, Notifications,
Onboarding, Roles, and Feature Reference
Sections 7 through 17 of PRD v5.0 are incorporated here by reference. No
changes to the core bookkeeping engine, file security gate, matching logic,
double entry rules, chart of accounts, export format, dashboard, notification
architecture, onboarding flow, or user roles. These sections remain authoritative
as written in v5.0 and will be merged into a single consolidated document in the
next editorial pass.

# 20. Legal and Compliance
Unchanged from v5.0. One GDPR-standard privacy policy. Sanctioned country
block at registration. Seven-year document retention. Compliance layer added per
jurisdiction upon reaching internal assessment threshold of approximately 50
paying organisations — this is a human business decision, never an automatic
system trigger.

# 21. Unit Economics
All figures below are estimates based on published API and infrastructure pricing
as of Q1 2026. Real usage data must validate these assumptions within the first 90
days of operation. Prices are expressed in USD for cost consistency; revenue is
shown in the relevant billing currency.

## 21.1 Bank Statement Parsing — Per Statement Cost
The parser uses an adaptive script cache architecture. Costs differ significantly
between cache hits (common) and cache misses (rare after initial ramp).
Cache miss — new bank format encountered (Claude Opus 4.6)
A cache miss triggers a full LLM invocation to generate a pdfplumber extraction
script. This is a platform-level cost — once a bank format is cached, all future

statements from that bank across all customers use the cached script at near-zero
LLM cost.
Assumptions: 3–5 page statement PDF, ~4,000 tokens input (PDF content +
generation prompt), ~2,000 tokens output (Python script). Total ~6,000 tokens per
miss.
Cost
Opus 4.6 input (4,000 tokens @ $15/M)

$0.060

Opus 4.6 output (2,000 tokens @ $75/M) $0.150
Total per cache miss

~$0.21

Cache misses are a platform investment, not a per-customer cost. Estimated total
cache miss events: ~50–100 across Indian banks, ~30–50 across Canadian banks
(later ramp), ~20–30 across Irish banks. Total platform cache-building cost:
approximately $20–$40 one-time across all major bank formats.
Cache hit — known bank format (no LLM)
Deterministic pdfplumber script runs as a Python subprocess. Cost is compute
only.
Cost
ECS Fargate compute (per statement, ~10 seconds) ~$0.001
S3 read (cached script)

negligible

Total per cache hit

~$0.001

Phase 5 normalisation — GPT-4o mini (every statement)
Runs on every parsed statement regardless of cache status. Receives clean
structured rows, returns normalised JSON with ISO dates, signed amounts, and
needs_invoice flags.
Assumptions: 50 transactions per statement average, ~2,500 tokens input, ~1,200
tokens output.
Cost
GPT-4o mini input (2,500 tokens @ $0.15/M)

$0.000375

GPT-4o mini output (1,200 tokens @ $0.60/M) $0.000720

Cost
Total per statement (Phase 5)

~$0.001

Total per statement parsed (mature stage, cache hit):
Component

Cost

pdfplumber execution

~$0.001

GPT-4o mini normalisation

~$0.001

S3 storage (2MB statement, 7-year retention) ~$0.003
Total per statement

~$0.005

At Growth tier (4 statements/month, 20 clients = 80 statements/month): parsing
cost ~$0.40/month per CA. Revenue at Growth tier: ~$35/month CAD (~$26
USD). Parsing cost is under 2% of revenue at mature stage.
Early stage (high cache miss rate ~30%):
Cache miss cost adds approximately $0.063 per statement on average. At 30%
miss rate across 80 statements: ~5 additional dollars per CA per month during
ramp. This compresses margin in months 1–3 and normalises as the cache fills.
Not a structural problem — a ramp cost.

## 21.2 CA Website Generation — Per CA Cost
One-time Sonnet API call at signup. Refresh calls on demand (estimated once per
6 months average).
Assumptions: onboarding questionnaire ~1,500 tokens input, website content
output ~3,000 tokens.
Cost
Sonnet input (1,500 tokens @ $3/M)

$0.0045

Sonnet output (3,000 tokens @ $15/M) $0.045
Total per website generation

~$0.05

Negligible relative to CA LTV at any tier. Even at Starter tier (~$11 USD/month),
one-time website generation cost is under 0.5% of first month revenue.

## 21.3 Storage — Per Customer Per Month

CA tier (Growth example):
20 clients × 50 documents/month × 500KB average = 500MB new
documents/month
20 clients × 4 bank statements × 2MB = 160MB statements/month
Total new storage: ~660MB/month
S3 Standard: $0.023/GB = ~$0.015/month storage addition
Cumulative over 12 months: ~8GB = ~$0.18/month by end of year one
Storage cost per CA is well under $0.25/month at Growth tier through year one.
Immaterial relative to revenue.
Independent BO (unlinked, ₹199/month ~$2.40 USD):
Cap: 500MB or 50 documents
Maximum storage cost at cap: 500MB × $0.023/GB = ~$0.012/month
GPT-4o mini parsing (assume 2 statements/month): ~$0.002/month
Total marginal cost per unlinked BO: ~$0.015/month
Revenue per unlinked BO: ~$2.40 USD
Gross margin on BO tier: ~99% at storage cap
The BO tier is economically sound as long as BOs do not massively exceed the
storage cap or generate excessive parsing volume. The cap enforces this.

⚠️ Watch metric: BO-to-CA ratio. If unlinked BOs outnumber CAs by more than
5:1, the aggregate free storage and parsing load requires review. The incentive
structure (free when linked to a CA) is designed to keep this ratio in check.

## 21.4 Summary Economics Table

Cost Item

Per Unit

Frequency

Notes

Bank statement parsing
(cache hit)

~$0.005

Per statement

Mature stage

Bank statement parsing
(cache miss)

~$0.21

Per new bank
format

Platform cost, onetime per bank

Cost Item

Per Unit

Frequency

Notes

GPT-4o mini
normalisation

~$0.001

Per statement

Every parse

CA website generation

~$0.05

Per CA at signup

One-time + refresh

S3 document storage

~$0.023/GB/month Ongoing

Custom domain SSL

~$0.10/month

Per CA on
Pro/Firm

ACM + DNS overhead

CA verification (manual,
V1)

Staff time

Per CA at signup

Automate in V2

Cumulative

⚠️ Standing convention: every significant product decision in this PRD that

introduces a cost (storage, AI calls, infrastructure) must be accompanied by an
economics note. Where unit economics are unvalidated, they are flagged
explicitly. Pricing decisions must not be finalised without a corresponding cost
analysis.

# 22. Open Items (Deferred, Not Forgotten)
Subdirectory canonical strategy — final decision pending
Blog and AI-assisted content tool — deferred until core product stable
BO direct path pricing in CAD and EUR — directional only, validation required
BO-to-CA ratio monitoring threshold — to be defined at launch
Programmatic CA verification — replacing manual V1 process
WhatsApp Business API integration — replacing wa.me redirect at scale
Payment gateway API integration (Razorpay, Stripe, Moneris) — V2
Full P&L and financial visibility dashboard — V2
Mobile application — V3
AI financial intelligence layer — V3
Expansion beyond India, Canada, Ireland — post-stabilisation

Document version 6.0. Supersedes PRD v5.0 for all sections explicitly updated
above. Sections not referenced above remain as written in v5.0 until the

consolidated editorial pass.

