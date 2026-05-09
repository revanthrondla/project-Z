**Feature, Compliance, Architecture, and Technology Design for the HR,
Time Tracking, and Invoicing Platform**

**Plain-English summary**

Think of the app like a smart school notebook for a business. One
section keeps track of people, one section keeps track of time, one
section turns approved work into invoices, and one section keeps proof
in case the business has to show records later.

The best first version should target consulting and professional
services because time turns directly into money there. The agriculture
version needs special farm tools, such as offline crew time, piece-rate
work, H-2A records, and bilingual worker screens, because H-2A employers
must track hours offered, hours worked, piece-rate units when used,
earnings, deductions, and other pay details ([[U.S. Department of
Labor]{.underline}](https://www.dol.gov/agencies/whd/fact-sheets/26-H2A)).
The retail version needs scheduling, shift changes, sick leave, minor
work rules, and predictive scheduling support in certain jurisdictions,
because retail buyers care most about who works which shift and whether
schedule changes create extra pay or record obligations ([[Oregon
BOLI]{.underline}](https://www.oregon.gov/boli/workers/pages/predictive-scheduling.aspx),
[[Seattle Office of Labor
Standards]{.underline}](https://www.seattle.gov/laborstandards/ordinances/secure-scheduling),
[[NYC Department of Consumer and Worker
Protection]{.underline}](https://www.nyc.gov/site/dca/businesses/fair-workweek-retail-employers.page)).

This document is not legal advice. It is a product and engineering
design that shows what the software should help customers record,
calculate, review, export, and audit.

**Product areas**

**Shared platform features**

These features should exist for every customer, no matter which industry
they are in.

  -------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  Area                       Detailed features                                                                                                                                                                                                         Why it matters
  Organization setup         Company profile, legal name, tax IDs, locations, departments, workweeks, time zones, default currency, invoice numbering, default pay periods, document retention policy.                                                 The app needs a "business folder" before it can organize people, hours, invoices, and rules.
  People records             Employee profile, contractor profile, emergency contact, job title, employment type, start date, end date, manager, work location, pay type, pay rate history, exempt/nonexempt flag, documents, notes, custom fields.    Employment records should preserve hiring, pay, promotion, termination, compensation, and other personnel records for required periods where applicable ([[EEOC]{.underline}](https://www.eeoc.gov/employers/summary-selected-recordkeeping-obligations-29-cfr-part-1602)).
  Role-based access          Owner, admin, manager, payroll reviewer, billing reviewer, employee, contractor, client approver, farm crew lead, store manager.                                                                                          A worker should see only their own time, while an owner can see business reports.
  Time tracking              Clock in/out, manual timesheet, timer, mobile time, kiosk time, break tracking, time categories, billable/non-billable, project/job/location/crop/shift tags, notes, attachments, approvals, corrections, lock periods.   Employers must keep employee time and pay records under FLSA, and nonexempt workers' pay and hours records must be complete and accurate ([[U.S. Department of Labor]{.underline}](https://www.dol.gov/agencies/whd/flsa), [[Employer.gov]{.underline}](https://www.employer.gov/pay-and-benefits/recordkeeping/)).
  Pay rules engine           Workweek setup, overtime rules, minimum wage checks, regular rate calculator, rounding rules, break rules, paid time off rules, sick leave accrual rules, holiday rules, location-based rules.                            Covered nonexempt employees must receive overtime for hours over 40 in a workweek at not less than one and one-half times the regular rate, and the regular rate is based on compensation and hours worked in that workweek ([[U.S. Department of Labor overtime]{.underline}](https://www.dol.gov/agencies/whd/overtime), [[U.S. Department of Labor regular rate]{.underline}](https://www.dol.gov/agencies/whd/fact-sheets/56a-regular-rate)).
  Approvals                  Employee submit, manager approve, finance approve, client approve, audit trail, rejection reason, re-open with permission, locked approved periods.                                                                       The app should create a clear chain of "who checked what and when."
  Invoicing                  Client records, project records, rate cards, invoice drafts from approved time, fixed-fee invoices, retainers, expenses, taxes, discounts, payment terms, PDF invoices, email delivery, invoice status, payment status.   The IRS states business records support income, deductions, payroll, sales, purchases, and tax return entries, so invoice and transaction records should be kept and exportable ([[IRS]{.underline}](https://www.irs.gov/businesses/small-businesses-self-employed/recordkeeping)).
  Payments                   Stripe or similar hosted checkout, ACH/card links, payment reconciliation, no raw card storage, webhook events, receipt emails.                                                                                           PCI DSS applies to entities that store, process, or transmit cardholder data, so the safest design is to use a payment processor and avoid storing card data directly ([[PCI Security Standards Council]{.underline}](https://www.pcisecuritystandards.org/standards/pci-dss/)).
  Exports and integrations   QuickBooks, Xero, Gusto export, payroll CSV, invoice CSV, time CSV, API keys, webhooks, SFTP export for enterprise customers.                                                                                             Customers usually keep accounting or payroll systems as the official money system, so this app should move clean data to those systems.
  Compliance center          Rule library, required fields by location/industry, missing-record alerts, retention dashboard, audit exports, policy acknowledgement tracking, legal hold flag, compliance report builder.                               Payroll records should be kept at least three years, wage calculation records such as time cards and schedules should be kept two years, and some personnel records have separate retention rules ([[Employer.gov]{.underline}](https://www.employer.gov/pay-and-benefits/recordkeeping/), [[EEOC]{.underline}](https://www.eeoc.gov/employers/summary-selected-recordkeeping-obligations-29-cfr-part-1602)).
  Privacy center             Data map, access/export/delete/correct workflows, consent/preferences, privacy notice links, sensitive data flags, retention/deletion queue.                                                                              CCPA/CPRA gives California residents rights to know, delete, correct, opt out of sale/sharing, limit sensitive personal information, and receive notice at collection where the law applies, and employment-related data is no longer generally exempt ([[California Attorney General]{.underline}](https://oag.ca.gov/privacy/ccpa)).
  Security                   MFA, SSO, audit logs, encryption, access reviews, session management, IP/device logs, least-privilege permissions, backup and recovery.                                                                                   FTC Safeguards Rule guidance describes written information security programs, access controls, encryption, MFA, monitoring, service provider oversight, incident response, and disposal controls for covered financial institutions, and these controls are good design for sensitive payroll and invoice systems even when applicability must be assessed by counsel ([[FTC]{.underline}](https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know)).
  Reporting                  Time reports, payroll-ready reports, invoice aging, project profitability, utilization, employee hours, overtime risk, missing approvals, compliance exceptions.                                                          Reports are the "dashboard lights" that warn owners when something needs attention.
  -------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**Target area features and compliance**

**Consulting and professional services**

**Feature set**

  ------------------------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  Module                          Detailed features
  Clients and projects            Client profiles, client contacts, project templates, project budget, billing model, contract dates, purchase order number, project manager, project status, project tags.
  Time-to-invoice workflow        Timer, weekly timesheet, billable/non-billable flag, project/task selection, approval workflow, invoice draft from approved time, billing notes, client approval portal.
  Rate cards                      Person rate, role rate, project rate, client-specific rates, effective dates, blended rates, overtime bill rates, internal cost rates.
  Utilization and profitability   Billable utilization, target utilization, project margin, estimated versus actual hours, unbilled time, write-offs, realization rate, retainer burn.
  Contractor management           Contractor profile, W-9 collection flag, contract start/end, hourly or fixed fee, statement of work, invoice matching, classification checklist, document storage.
  Expense tracking                Reimbursable expenses, receipt upload, expense approval, client billable flag, mileage, per diem, invoice pass-through.
  Client portal                   Approve time, comment on rejected entries, download invoices, view project status, pay invoices, see retainer balance.
  Integrations                    QuickBooks Online, Xero, Stripe, Gusto export, Google Calendar or Outlook calendar import, Slack/Teams reminders, CSV API.
  ------------------------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**Compliance and controls**

  --------------------------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  Compliance area             Requirement to support                                                                                                                                                                                                                                                                                                                                                                                Product control
  FLSA time and pay records   Employers must keep employee time and pay records, and covered nonexempt employees are entitled to minimum wage and overtime protections ([[U.S. Department of Labor]{.underline}](https://www.dol.gov/agencies/whd/flsa)).                                                                                                                                                                           Store time entries, workweek, pay type, pay rate history, overtime calculations, corrections, approvals, and payroll exports.
  Overtime                    Overtime is required for covered nonexempt employees for hours over 40 in a fixed 168-hour workweek at not less than one and one-half times the regular rate ([[U.S. Department of Labor overtime]{.underline}](https://www.dol.gov/agencies/whd/overtime)).                                                                                                                                          Pay-rule engine should calculate weekly overtime, prevent averaging across weeks, and show regular-rate assumptions.
  Regular rate                Overtime must be based on the regular rate, and the regular rate is generally calculated from total compensation for employment divided by hours worked in the workweek, subject to statutory exclusions ([[U.S. Department of Labor regular rate]{.underline}](https://www.dol.gov/agencies/whd/fact-sheets/56a-regular-rate)).                                                                      Store earning components, classify included/excluded pay, and generate an overtime audit explanation.
  Contractor classification   DOL's 2024 independent contractor final rule became effective March 11, 2024 and is intended to reduce misclassification risk under FLSA ([[U.S. Department of Labor]{.underline}](https://www.dol.gov/agencies/whd/flsa/misclassification/rulemaking)).                                                                                                                                              Add a contractor onboarding checklist, classification notes, reviewer approval, and reminder to consult counsel.
  I-9 retention               Federal regulation requires employers to retain Form I-9 for three years after hire or one year after employment termination, whichever is later ([[Cornell Legal Information Institute copy of 8 CFR § 274a.2]{.underline}](https://www.law.cornell.edu/cfr/text/8/274a.2)).                                                                                                                         Store I-9 metadata and retention dates, or integrate with an I-9 provider; if storing electronic I-9s, support audit trails, indexing, access controls, legible reproduction, and secure retrieval.
  Personnel records           Private employers covered by EEOC recordkeeping rules generally preserve personnel or employment records for one year from the making of the record or personnel action, whichever is later, and discrimination-charge-related records must be retained until final disposition ([[EEOC]{.underline}](https://www.eeoc.gov/employers/summary-selected-recordkeeping-obligations-29-cfr-part-1602)).   Add retention labels, legal hold, discrimination charge hold, and exportable personnel file.
  Tax and business records    IRS guidance says businesses should keep records long enough to prove income or deductions on a tax return and keep employment tax records for at least four years ([[IRS]{.underline}](https://www.irs.gov/businesses/small-businesses-self-employed/recordkeeping)).                                                                                                                                Store invoices, receipts, payroll exports, payment records, and tax-relevant exports with retention policies.
  --------------------------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**Agriculture**

**Feature set**

  ------------------------------ ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  Module                         Detailed features
  Farm setup                     Farms, ranches, blocks, rows, fields, crops, varieties, packhouses, warehouses, housing locations, work contracts, seasons.
  Crew management                Crew leaders, crews, group clock-in/out, crew transfer, job reassignment, supervisor notes, bulk approvals.
  Offline mobile                 Offline-first app, local device storage, sync queue, conflict resolution, low-bandwidth mode, device pairing, kiosk mode.
  Hourly and piece-rate work     Hourly jobs, piece-rate jobs, units picked/packed, crop and block tagging, daily production totals, minimum wage make-up calculation, piece-rate earnings statement fields.
  H-2A tracking                  Worker contract period, hours offered, hours worked, three-fourths guarantee progress, AEWR/prevailing wage field, deductions, housing/transport notes, payroll statement support.
  Safety and pesticide records   Pesticide application records, Safety Data Sheet links, restricted-entry interval notices, worker training records, decontamination checklist, request log for pesticide/hazard information.
  Payroll exports                Export by worker, crew, crop, job, location, piece units, hourly work, deductions, reimbursements, pay period, farm payroll provider mapping.
  Bilingual worker UX            English/Spanish worker screens, icon-led clocking, supervisor mode, audio prompts if needed, simplified worker portal.
  Audit reports                  H-2A hours report, piece-rate report, deductions report, earnings statement report, pesticide information request report, payroll export audit trail.
  ------------------------------ ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**Compliance and controls**

  --------------------------------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- --------------------------------------------------------------------------------------------------------------------------------------------------------
  Compliance area                   Requirement to support                                                                                                                                                                                                                                                                                                                                Product control
  H-2A wages                        H-2A employers must pay covered workers at least the highest of the AEWR, prevailing wage, collective bargaining rate, or federal/state minimum wage, and piece-rate pay must average at least the required hourly wage on a pay-period basis ([[U.S. Department of Labor]{.underline}](https://www.dol.gov/agencies/whd/fact-sheets/26-H2A)).        Store required wage source, wage rate, piece-rate units, pay-period minimum wage make-up calculation, and exception alerts.
  H-2A records                      H-2A employers must keep accurate records of hours offered each day and hours actually worked each day by each worker ([[U.S. Department of Labor]{.underline}](https://www.dol.gov/agencies/whd/fact-sheets/26-H2A)).                                                                                                                                Daily worker ledger for offered hours, worked hours, job, crop, location, crew leader, and correction history.
  H-2A earnings statements          On or before each payday, at least twice monthly, each worker must receive an hours and earnings statement showing hours offered, hours worked, hourly or piece rate, daily units if piece rates are used, total earnings, and deductions ([[U.S. Department of Labor]{.underline}](https://www.dol.gov/agencies/whd/fact-sheets/26-H2A)).            Generate worker statements and payroll export packets with required fields.
  H-2A three-fourths guarantee      H-2A employers must guarantee employment for at least 75% of the workdays in the contract period and pay shortfall amounts if sufficient work is not offered ([[U.S. Department of Labor]{.underline}](https://www.dol.gov/agencies/whd/fact-sheets/26-H2A)).                                                                                         Contract progress tracker, projected shortfall alert, guarantee calculator, and end-of-contract reconciliation.
  H-2A housing and transportation   H-2A employers must provide required housing and certain transportation at no cost under the conditions described by DOL, and transportation must meet applicable safety standards ([[U.S. Department of Labor]{.underline}](https://www.dol.gov/agencies/whd/fact-sheets/26-H2A)).                                                                   Store housing assignment, transport route, inspection files, proof documents, and issue logs without presenting the app as a legal certification tool.
  Worker Protection Standard        EPA's WPS requires annual pesticide safety training, access to pesticide application information and Safety Data Sheets, and access within 15 days for certain written requests by workers, handlers, or designated representatives ([[EPA]{.underline}](https://www.epa.gov/pesticide-worker-safety/agricultural-worker-protection-standard-wps)).   Training record module, pesticide application log, SDS library, restricted-entry interval notices, request tracker, 15-day response timer.
  FLSA and record retention         FLSA and [[Employer.gov]{.underline}](http://Employer.gov) guidance require complete and accurate pay and hours records, with payroll records kept at least three years and wage calculation records such as time cards and schedules kept two years ([[Employer.gov]{.underline}](https://www.employer.gov/pay-and-benefits/recordkeeping/)).        Retention engine should classify time cards, schedules, payroll exports, and wage tables by required retention period.
  --------------------------------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- --------------------------------------------------------------------------------------------------------------------------------------------------------

**Retail**

**Feature set**

  ----------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------
  Module                        Detailed features
  Store and location setup      Stores, departments, roles, managers, store hours, time zones, labor budget, POS integration settings.
  Scheduling                    Schedule builder, templates, open shifts, shift swaps, availability, time-off conflicts, role coverage, break planning, schedule publishing.
  Time clock                    Mobile/tablet/POS clock-in, PIN/photo optional, geofence optional, missed punch workflow, break clocking, manager correction, timecard approval.
  Predictive scheduling         Advance schedule notice rules, schedule-change tracking, worker consent, premium pay calculation, standby list, right-to-rest warning, access-to-hours workflow.
  Paid sick leave               State/local sick leave policy configuration, accrual, frontload, usage cap, carryover, balance display, paystub export, recordkeeping.
  Youth employment guardrails   Age field, school-day/non-school-day flags where configured, hazardous job restrictions as configurable policy warnings, manager override with reason.
  Payroll handoff               Approved hours, overtime, sick leave, premium pay, tips if later supported, export to payroll provider.
  Store reporting               Labor percent, overtime risk, schedule change costs, late/early clock-ins, missed breaks, sick leave balances, compliance exceptions.
  ----------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------

**Compliance and controls**

  ------------------------------------------------ ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -----------------------------------------------------------------------------------------------------------------------------------------
  Compliance area                                  Requirement to support                                                                                                                                                                                                                                                                                                                                                                   Product control
  FLSA wage and overtime                           Covered nonexempt workers are entitled to the federal minimum wage and overtime for hours over 40 in a workweek, with higher state minimum wage applying where state law is higher ([[U.S. Department of Labor]{.underline}](https://www.dol.gov/agencies/whd/flsa), [[U.S. Department of Labor overtime]{.underline}](https://www.dol.gov/agencies/whd/overtime)).                      Minimum wage checker, weekly overtime calculator, regular rate inputs, wage table by location.
  Youth employment                                 DOL YouthRules says federal and state child labor rules can both apply, and whichever standard is more protective applies where they differ ([[U.S. Department of Labor YouthRules]{.underline}](https://www.dol.gov/agencies/whd/youthrules)).                                                                                                                                          Age-based scheduling warnings, restricted job flags, configurable state rules, manager override audit trail.
  California paid sick leave                       California requires most covered workers to receive at least 40 hours or five days of paid sick leave per year starting January 1, 2024, with accrual at least one hour per 30 hours worked when using that accrual method ([[California DIR]{.underline}](https://www.dir.ca.gov/dlse/California-Paid-Sick-Leave.html)).                                                                Sick leave policy engine, accrual ledger, frontload option, carryover rules, usage cap, balance export.
  California sick leave recordkeeping and notice   California FAQ states employers must show available sick leave on a pay stub or same-day document and keep records showing paid sick days earned and used for three years ([[California DIR FAQ]{.underline}](https://www.dir.ca.gov/dlse/paid_sick_leave.htm)).                                                                                                                         Paystub balance export, employee balance view, earned/used ledger, three-year retention tag.
  Oregon predictive scheduling                     Oregon predictive scheduling applies to covered retail, hospitality, and food service employers with at least 500 employees worldwide and requires written schedules at least 14 days in advance, with additional compensation for certain employer-requested changes ([[Oregon BOLI]{.underline}](https://www.oregon.gov/boli/workers/pages/predictive-scheduling.aspx)).               Jurisdiction rule toggle, 14-day schedule publishing, change reason, premium pay calculator, voluntary standby list records.
  Seattle secure scheduling                        Seattle covers hourly retail and food service employees at establishments with 500+ employees worldwide and requires 14-day schedule notice, right to decline added hours, predictability pay, access to hours, good faith estimates, and three-year records ([[Seattle Office of Labor Standards]{.underline}](https://www.seattle.gov/laborstandards/ordinances/secure-scheduling)).   Seattle rule pack, good faith estimate form, access-to-hours posting workflow, premium pay calculations, three-year compliance archive.
  NYC retail fair workweek                         NYC retail employers must give work schedules 72 hours before the first shift, cannot schedule on-call shifts, cannot cancel a shift with less than 72 hours' notice, and cannot require work with less than 72 hours' notice unless the employee agrees ([[NYC DCWP]{.underline}](https://www.nyc.gov/site/dca/businesses/fair-workweek-retail-employers.page)).                        NYC rule pack, 72-hour publishing lock, on-call shift blocker, worker consent capture, schedule change audit log.
  ------------------------------------------------ ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -----------------------------------------------------------------------------------------------------------------------------------------

**Architecture, explained simply**

Imagine the app is a restaurant:

-   The **frontend** is the menu and counter where people order.

-   The **API** is the waiter who takes requests to the kitchen.

-   The **database** is the pantry and filing cabinet.

-   The **queue** is the line of chores that can happen later, like
    sending emails.

-   The **rules engine** is the calculator that checks laws, overtime,
    sick leave, and schedule rules.

-   The **audit log** is the security camera that records who changed
    what.

**System diagram**

flowchart TD\
U\[Users: owners, managers, workers, clients\] \--\> WEB\[Next.js Web
App\]\
U \--\> MOB\[Mobile/PWA App\]\
WEB \--\> API\[Fastify API\]\
MOB \--\> API\
API \--\> AUTH\[Auth and RBAC\]\
API \--\> CORE\[Core Services\]\
CORE \--\> PEOPLE\[People Service\]\
CORE \--\> TIME\[Time Service\]\
CORE \--\> SCHED\[Scheduling Service\]\
CORE \--\> BILL\[Billing and Invoicing Service\]\
CORE \--\> RULES\[Compliance Rules Engine\]\
CORE \--\> DOCS\[Document Service\]\
CORE \--\> REPORTS\[Reporting Service\]\
CORE \--\> AUDIT\[Audit Log Service\]\
PEOPLE \--\> DB\[(PostgreSQL)\]\
TIME \--\> DB\
SCHED \--\> DB\
BILL \--\> DB\
RULES \--\> DB\
AUDIT \--\> DB\
DOCS \--\> S3\[(Object Storage)\]\
API \--\> REDIS\[(Redis Cache)\]\
API \--\> QUEUE\[BullMQ Jobs\]\
QUEUE \--\> EMAIL\[Email/SMS Provider\]\
QUEUE \--\> EXPORTS\[Payroll and Accounting Exports\]\
BILL \--\> STRIPE\[Stripe Payments\]\
BILL \--\> QB\[QuickBooks/Xero\]

**Recommended technology stack**

This stack is practical for a SaaS product, typed end to end, and
flexible enough for web, mobile, offline agriculture, and
compliance-heavy workflows.

  ------------------ --------------------------------------------------------------------------------- ----------------------------------------------------------------------------------------------------------------------------
  Layer              Recommended technology                                                            Why
  Web frontend       Next.js with App Router, TypeScript, Tailwind CSS, shadcn/ui                      Fast to build, good for dashboards, typed forms, and production web apps.
  Mobile/offline     Progressive Web App first; React Native later for agriculture-heavy offline use   A PWA gets you mobile quickly; React Native is better if farm offline use becomes core.
  Backend API        Node.js TypeScript with Fastify                                                   Strong performance, clean APIs, good validation, and easy integration work.
  Validation         Zod                                                                               One clear way to validate API inputs and form data.
  Database           PostgreSQL                                                                        Best default for relational data such as companies, people, time entries, invoices, schedules, rules, and audit logs.
  ORM                Prisma or Drizzle                                                                 Prisma is faster for product development; Drizzle gives more SQL control. Pick Prisma for MVP.
  Cache and queues   Redis plus BullMQ                                                                 Redis supports caching and BullMQ handles background jobs like emails, exports, invoice PDF generation, and reminder jobs.
  Object storage     S3-compatible storage                                                             Stores documents, receipts, invoice PDFs, I-9 files if supported, pesticide SDS files, and exports.
  Auth               Clerk for speed or Auth0 for enterprise; support SAML later                       Saves time on secure login, MFA, organizations, and user management.
  Payments           Stripe Checkout and Stripe Billing                                                Avoid storing raw card data and reduce PCI scope.
  Analytics          PostHog for product analytics; OpenTelemetry for engineering traces               Product analytics shows usage; traces help debug slow workflows.
  Monitoring         Sentry, Grafana/Prometheus, structured Pino logs                                  Find errors, performance problems, and system health issues.
  Infrastructure     AWS ECS/Fargate or Railway/Fly.io for MVP; RDS Postgres; ElastiCache Redis; S3    Start simple, then move to a stricter AWS setup when customers and compliance needs grow.
  CI/CD              GitHub Actions                                                                    Run tests, type checks, migrations, and deployments automatically.
  Testing            Vitest, React Testing Library, Playwright, Supertest                              Covers business rules, UI, API, and end-to-end workflows.
  ------------------ --------------------------------------------------------------------------------- ----------------------------------------------------------------------------------------------------------------------------

**Service design**

  --------------------- --------------------------------------------------------------------------------------------------- ------------------------------------------------------------------------------------------------
  Service               Owns                                                                                                Main API examples
  Identity and access   Organizations, users, roles, permissions, sessions, SSO mapping.                                    POST /api/v1/invites, GET /api/v1/me, PATCH /api/v1/roles/:id
  People                Employees, contractors, documents, job history, pay rate history, I-9 metadata, retention labels.   POST /api/v1/people, GET /api/v1/people/:id, POST /api/v1/people/:id/documents
  Time                  Time entries, timers, breaks, corrections, approvals, lock periods.                                 POST /api/v1/time-entries, POST /api/v1/timers/start, POST /api/v1/time-periods/:id/approve
  Scheduling            Shifts, availability, time off, schedule publishing, shift swaps, predictive scheduling events.     POST /api/v1/shifts, POST /api/v1/schedules/:id/publish, POST /api/v1/shifts/:id/consent
  Billing               Clients, projects, rates, invoice drafts, invoice PDFs, payments, accounting sync.                  POST /api/v1/invoices/from-time, POST /api/v1/invoices/:id/send, POST /api/v1/payments/webhook
  Compliance rules      Overtime, sick leave, H-2A, predictive scheduling, retention, required fields, exception checks.    POST /api/v1/compliance/check, GET /api/v1/compliance/exceptions
  Documents             Secure file upload, previews, retention, deletion, legal holds.                                     POST /api/v1/documents/upload-url, GET /api/v1/documents/:id/download-url
  Reporting             Dashboards, exports, payroll packets, audit reports, invoice aging.                                 GET /api/v1/reports/time, GET /api/v1/reports/payroll-export, GET /api/v1/reports/compliance
  Notifications         Email, SMS, in-app alerts, reminders, digest jobs.                                                  POST /api/v1/notifications/test, background jobs only for most sends.
  Audit                 Immutable audit events, access logs, export logs, correction logs.                                  GET /api/v1/audit-events
  --------------------- --------------------------------------------------------------------------------------------------- ------------------------------------------------------------------------------------------------

**Core database design**

The database should be multi-tenant from day one. Every customer belongs
to an organization, and nearly every table should include
organization\_id.

  ---------------------- -----------------------------------------------------------------------------------------------------------------------------------------------------
  Table group            Important tables
  Tenant and auth        organizations, locations, users, memberships, roles, permissions, api\_keys, sessions.
  People                 people, employment\_profiles, contractor\_profiles, pay\_rate\_history, job\_history, documents, document\_retention\_policies, i9\_records.
  Time                   time\_entries, time\_entry\_events, break\_entries, time\_periods, approvals, corrections, lock\_periods.
  Projects and billing   clients, projects, tasks, rate\_cards, expenses, invoice\_drafts, invoices, invoice\_lines, payments, accounting\_sync\_jobs.
  Scheduling             schedules, shifts, availability, time\_off\_requests, shift\_swaps, schedule\_change\_events, predictability\_pay\_events.
  Agriculture            farms, fields, blocks, crops, crews, piece\_work\_entries, h2a\_contracts, h2a\_daily\_ledgers, pesticide\_applications, safety\_training\_records.
  Retail                 stores, departments, labor\_budgets, sick\_leave\_ledgers, youth\_work\_rule\_checks, posted\_schedules.
  Compliance             rule\_packs, rule\_versions, compliance\_checks, compliance\_exceptions, retention\_jobs, legal\_holds.
  Audit and security     audit\_events, access\_logs, export\_logs, webhook\_events, security\_events.
  ---------------------- -----------------------------------------------------------------------------------------------------------------------------------------------------

**Important workflows**

**Consulting workflow: time to invoice**

sequenceDiagram\
participant Worker\
participant Manager\
participant Finance\
participant App\
participant Client\
Worker-\>\>App: Enters billable time\
App-\>\>App: Checks project, rate, required notes\
Manager-\>\>App: Approves or rejects time\
Finance-\>\>App: Creates invoice from approved time\
App-\>\>Client: Sends invoice and payment link\
Client-\>\>App: Pays or downloads invoice\
App-\>\>App: Stores audit trail and accounting sync status

**Agriculture workflow: crew work to payroll packet**

sequenceDiagram\
participant CrewLead\
participant Worker\
participant App\
participant Payroll\
CrewLead-\>\>App: Starts crew work offline\
Worker-\>\>App: Records hours or piece units\
App-\>\>App: Syncs when internet returns\
App-\>\>App: Checks H-2A hours, piece units, minimum wage, guarantee
progress\
App-\>\>Payroll: Exports payroll-ready packet\
App-\>\>App: Saves earnings statement and audit report

**Retail workflow: schedule publish to payroll**

sequenceDiagram\
participant Manager\
participant Worker\
participant App\
participant Payroll\
Manager-\>\>App: Publishes schedule\
App-\>\>App: Checks advance notice and right-to-rest rules\
Worker-\>\>App: Clocks in and out\
Manager-\>\>App: Changes shift if needed\
App-\>\>App: Calculates premium pay if rule applies\
Manager-\>\>App: Approves timecards\
App-\>\>Payroll: Sends hours, sick leave, overtime, premium pay

**Compliance rules engine design**

The rules engine should work like a "referee." Every time someone saves
a time entry, publishes a schedule, creates an invoice, or exports
payroll, the referee checks the rules and says either "looks okay" or
"warning, fix this."

**Rule structure**

Rule Pack\
Country: United States\
State: California\
City: Los Angeles, optional\
Industry: retail, agriculture, consulting, all\
Effective date range\
Rule type: overtime, sick leave, predictive scheduling, H-2A, retention\
Inputs required\
Calculation\
Output: pass, warning, block, premium pay, missing data

**Rule examples**

  ------------------------------ -------------------------------------------------------------------------------------------------- -------------------------------------------------------------
  Rule                           Inputs                                                                                             Output
  Weekly overtime                Worker status, workweek, hours, regular rate inputs.                                               Overtime hours and overtime pay warning.
  California sick leave          Work location, hours worked, policy type, hire date, accrued/used balances.                        Accrued sick leave, available balance, recordkeeping label.
  H-2A guarantee                 Contract dates, expected workdays, hours offered, hours worked, wage rate.                         Guarantee progress and projected shortfall.
  Oregon predictive scheduling   Employer coverage flag, shift publish date, shift start date, change event, worker request flag.   Premium pay event or no premium pay.
  I-9 retention                  Hire date, termination date.                                                                       Destroy-after date and legal hold check.
  ------------------------------ -------------------------------------------------------------------------------------------------- -------------------------------------------------------------

**Security and privacy design**

  ----------------------------- -------------------------------------------------------------------------------------------------------------------------------
  Control                       Design
  Authentication                MFA required for admins; optional for workers at first; SSO for larger customers.
  Authorization                 Role-based access control plus row-level tenant checks on every request.
  Encryption                    TLS in transit, database encryption at rest, object storage encryption, field-level encryption for SSN-like values if stored.
  Audit log                     Record create/update/delete/export/login/security events; do not allow normal admins to edit audit logs.
  Sensitive data minimization   Store only what is needed; prefer metadata and links to specialist systems for I-9, payroll, and payments when possible.
  Backups                       Daily database backups, point-in-time recovery, tested restore process.
  Retention                     Retention policies by document type, legal hold override, deletion queue, destruction certificate.
  Incident response             Incident severity, affected tenants, timeline, customer notice workflow, evidence collection.
  Vendor management             Track subprocessors, DPAs, data locations, and security reviews.
  ----------------------------- -------------------------------------------------------------------------------------------------------------------------------

**Implementation roadmap**

**Phase 1: Consulting MVP**

Build this first because it proves the time-to-cash workflow.

-   Organization setup, people records, roles, clients, projects, rate
    cards.

-   Time entries, timers, approvals, corrections, lock periods.

-   Invoice drafts from approved time, invoice PDFs, Stripe payment
    links.

-   QuickBooks/Xero CSV export before deep API sync.

-   Basic FLSA workweek/overtime support and record retention labels.

-   Audit logs for time, approvals, invoices, exports, and user access.

-   Reports for billable utilization, unbilled time, invoice aging, and
    project margin.

**Phase 2: Compliance hardening**

-   Configurable rule packs by state, city, industry, and effective
    date.

-   I-9 retention metadata and secure document storage or integration
    with a specialist I-9 provider.

-   EEOC personnel retention labels and legal hold.

-   CCPA/CPRA privacy request workflow for access, deletion, correction,
    and sensitive information flags where applicable.

-   SOC 2 readiness controls: access review, change logs, vendor
    register, incident response, backup test evidence.

**Phase 3: Agriculture vertical**

-   Offline-first mobile/PWA worker app.

-   Farms, fields, blocks, crops, crews, piece-rate entries.

-   H-2A contracts, hours offered, hours worked, three-fourths
    guarantee.

-   Earnings statement generator and payroll export packets.

-   Pesticide application logs, SDS library, safety training records,
    restricted-entry interval notices.

-   English/Spanish worker and crew leader interface.

**Phase 4: Retail vertical**

-   Store scheduling, availability, time off, shift swaps, open shifts.

-   Predictive scheduling rule packs for Oregon, Seattle, NYC, and other
    jurisdictions as customers require.

-   Paid sick leave policy engine and balance reporting.

-   Youth employment warning system.

-   POS integration and labor budget reporting.

-   Premium pay and payroll export support.

**Phase 5: Scale and enterprise**

-   Public API and webhooks.

-   SAML SSO and SCIM.

-   Advanced accounting sync.

-   Data warehouse exports.

-   Dedicated audit report package.

-   Mobile native app if offline agriculture adoption justifies it.

**Suggested repository structure**

hr-time-invoicing/\
apps/\
web/\
src/app/\
src/components/\
src/features/\
src/lib/\
mobile/\
src/\
services/\
api/\
src/routes/v1/\
src/services/\
src/repositories/\
src/jobs/\
src/lib/\
workers/\
src/\
packages/\
db/\
prisma/schema.prisma\
migrations/\
rules-engine/\
src/\
rule-packs/\
shared/\
src/types/\
src/schemas/\
ui/\
src/\
infra/\
terraform/\
docker/\
docs/\
architecture/\
compliance/

**Required environment variables**

DATABASE\_URL=\
REDIS\_URL=\
S3\_BUCKET=\
S3\_REGION=\
S3\_ACCESS\_KEY\_ID=\
S3\_SECRET\_ACCESS\_KEY=\
CLERK\_SECRET\_KEY=\
CLERK\_PUBLISHABLE\_KEY=\
STRIPE\_SECRET\_KEY=\
STRIPE\_WEBHOOK\_SECRET=\
SENDGRID\_API\_KEY=\
APP\_ENCRYPTION\_KEY=\
AUDIT\_LOG\_SIGNING\_KEY=\
NEXT\_PUBLIC\_APP\_URL=

**Key engineering decisions**

  --------------------- -------------------------------------------------------------------- --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  Decision              Choice                                                               Reason
  Product shape         Modular monolith first                                               Easier to build and debug than microservices while still keeping modules clean.
  Database              PostgreSQL                                                           Time, people, invoices, rules, and audits are relational and need transactions.
  Rule handling         Versioned rule packs                                                 Laws and policies change, so every calculation needs to know which rule version applied at the time.
  Offline strategy      PWA offline first, React Native later                                Lets agriculture test offline workflows before investing in full native apps.
  Payments              Stripe-hosted payment flows                                          Reduces PCI scope by avoiding raw card storage.
  I-9                   Integrate first, store carefully only if needed                      Electronic I-9 storage has detailed retention, security, indexing, audit, and reproduction requirements ([[Cornell Legal Information Institute copy of 8 CFR § 274a.2]{.underline}](https://www.law.cornell.edu/cfr/text/8/274a.2)).
  Compliance language   "Helps support records and workflows," not "guarantees compliance"   Laws vary by location and customer facts, so the product should produce evidence and warnings rather than promise legal outcomes.
  --------------------- -------------------------------------------------------------------- --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**What not to build first**

-   Full payroll tax filing, because payroll tax engines are complex and
    jurisdiction-specific.

-   Benefits administration, because it is not required for the first
    time-to-cash wedge.

-   AI scheduling for retail, because retail should not be the first
    vertical unless scheduling becomes the core product.

-   Full public API before the internal data model stabilizes.

-   A custom payment-card vault, because hosted processors reduce PCI
    scope.

-   A custom legal advice engine, because the app should provide rule
    checks and records, not legal conclusions.

**Final recommendation**

Build the first release around consulting: people, projects, time,
approvals, invoices, reports, accounting exports, audit logs, and basic
wage/hour record support. Then harden compliance infrastructure before
adding agriculture and retail, because agriculture and retail add
location-specific and industry-specific rules that must be versioned,
explainable, and auditable.

The simplest product promise should be: "We help businesses know who
worked, what they worked on, what they should bill, what records they
need, and where the risky gaps are."
