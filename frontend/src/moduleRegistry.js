/**
 * HireIQ Frontend Module Registry
 *
 * Must stay in sync with backend/moduleRegistry.js.
 * Used by:
 *   - Tenants.jsx (superadmin) — renders module toggle panel grouped by category
 *   - ModulesContext.jsx — client-side module gating via hasModule(key)
 */

export const MODULE_REGISTRY = [

  // ── Staffing Core ──────────────────────────────────────────────────────────
  {
    key:         'hr_candidates',
    name:        'Employees',
    category:    'Staffing',
    description: 'Employee profiles, placement tracking, and hourly rate management',
    icon:        '👥',
    default:     true,
  },
  {
    key:         'hr_clients',
    name:        'Clients',
    category:    'Staffing',
    description: 'Client company management and contact details',
    icon:        '🏢',
    default:     true,
  },
  {
    key:         'hr_jobs',
    name:        'Jobs Board',
    category:    'Staffing',
    description: 'Job postings, applications, and hiring pipeline',
    icon:        '💼',
    default:     true,
  },
  {
    key:         'hr_timesheets',
    name:        'Timesheets',
    category:    'Staffing',
    description: 'Time entry logging, approval workflows, and hour tracking',
    icon:        '⏱️',
    default:     true,
  },
  {
    key:         'hr_absences',
    name:        'Absence Management',
    category:    'Staffing',
    description: 'Leave requests, PTO balances, absence tracking and approval',
    icon:        '🏖️',
    default:     true,
  },
  {
    key:         'hr_attendance',
    name:        'Attendance & Clock',
    category:    'Staffing',
    description: 'Clock-in/out with GPS, break tracking, real-time attendance dashboard and public holidays',
    icon:        '📍',
    default:     true,
  },
  {
    key:         'hr_invoices',
    name:        'Invoices',
    category:    'Staffing',
    description: 'Invoice generation, PDF download, and payment status tracking',
    icon:        '📄',
    default:     true,
  },
  {
    key:         'hr_documents',
    name:        'Documents',
    category:    'Staffing',
    description: 'Document storage and e-signatures (single, two-way, three-way)',
    icon:        '📁',
    default:     true,
  },

  // ── Consulting & Projects ──────────────────────────────────────────────────
  {
    key:         'hr_projects',
    name:        'Projects',
    category:    'Consulting',
    description: 'Project and task management, rate cards, budget tracking and utilization reporting',
    icon:        '📂',
    default:     true,
  },
  {
    key:         'hr_expenses',
    name:        'Expenses',
    category:    'Consulting',
    description: 'Employee expense submissions, receipts, approval workflows and billable expense tracking',
    icon:        '🧾',
    default:     true,
  },
  {
    key:         'hr_rate_cards',
    name:        'Rate Cards',
    category:    'Consulting',
    description: 'Custom billing rate structures per project, role or client',
    icon:        '💳',
    default:     false,
  },

  // ── Finance & Payroll ──────────────────────────────────────────────────────
  {
    key:         'hr_payroll',
    name:        'Payroll',
    category:    'Finance',
    description: 'Payroll reconciliation, payslip generation and payroll export',
    icon:        '💼',
    default:     true,
  },
  {
    key:         'hr_pay_rules',
    name:        'Pay Rules',
    category:    'Finance',
    description: 'Overtime rules, penalty rates, award-based pay calculations and pay rule engine',
    icon:        '⚖️',
    default:     false,
  },
  {
    key:         'hr_scheduled_reports',
    name:        'Scheduled Reports',
    category:    'Finance',
    description: 'Automated weekly/monthly report delivery to stakeholders via email (CSV or PDF)',
    icon:        '📅',
    default:     false,
  },

  // ── Analytics & Reports ────────────────────────────────────────────────────
  {
    key:         'hr_reports',
    name:        'Reports',
    category:    'Analytics',
    description: 'Hours, absence, revenue, labor cost and utilization reports with date-range filtering and charts',
    icon:        '📊',
    default:     true,
  },
  {
    key:         'hr_import',
    name:        'CSV Import',
    category:    'Analytics',
    description: 'Bulk import employees, clients and time entries from CSV files',
    icon:        '📥',
    default:     false,
  },

  // ── Workforce Operations ───────────────────────────────────────────────────
  {
    key:         'hr_contractors',
    name:        'Contractors',
    category:    'Workforce',
    description: 'Contractor-specific profiles, C2C job board and contractor pipeline management',
    icon:        '🤝',
    default:     false,
  },
  {
    key:         'hr_custom_fields',
    name:        'Custom Fields',
    category:    'Workforce',
    description: 'Extend employee, timesheet, absence, invoice and project records with custom attributes',
    icon:        '🔧',
    default:     false,
  },

  // ── Compliance & Governance ────────────────────────────────────────────────
  {
    key:         'hr_compliance',
    name:        'Compliance Center',
    category:    'Compliance',
    description: 'Data retention policy enforcement, GDPR RoPA, data breach register and compliance dashboard',
    icon:        '🛡️',
    default:     true,
  },
  {
    key:         'hr_eeo',
    name:        'EEO Reporting',
    category:    'Compliance',
    description: 'Equal Employment Opportunity data collection and government report generation',
    icon:        '⚖️',
    default:     false,
  },

  // ── Portals & Communication ────────────────────────────────────────────────
  {
    key:         'client_portal',
    name:        'Client Portal',
    category:    'Portals',
    description: 'Self-service portal for clients to view invoices, approve timesheets and track project status',
    icon:        '🔗',
    default:     true,
  },
  {
    key:         'hr_support',
    name:        'Support Tickets',
    category:    'Portals',
    description: 'In-app support ticketing — employees and clients raise tickets, admins manage and respond',
    icon:        '🎫',
    default:     true,
  },

  // ── AI & Automation ────────────────────────────────────────────────────────
  {
    key:         'hr_id_scan',
    name:        'ID Scan Hiring',
    category:    'AI',
    description: 'Real-time OCR from government-issued ID documents — live camera or file upload — for rapid bulk employee on-boarding. Uses open-source Ollama/Tesseract or cloud AI.',
    icon:        '🪪',
    default:     false,
  },
  {
    key:         'ai_assistant',
    name:        'AI Assistant',
    category:    'AI',
    description: 'Conversational AI — ask questions about your data, create employees, generate invoices and more',
    icon:        '🤖',
    default:     false,
  },

  // ── Field Ops (AgRow) ──────────────────────────────────────────────────────
  {
    key:         'agrow_scan',
    name:        'Field Scan',
    category:    'Field Ops',
    description: 'Barcode + camera scanning in the field with offline-first support',
    icon:        '📷',
    default:     false,
  },
  {
    key:         'agrow_scanned_products',
    name:        'Scanned Products',
    category:    'Field Ops',
    description: 'View and manage all field scan records',
    icon:        '🌾',
    default:     false,
  },
  {
    key:         'agrow_analytics',
    name:        'Harvest Analytics',
    category:    'Field Ops',
    description: 'Production metrics, daily trend charts and crew performance analysis',
    icon:        '📈',
    default:     false,
  },
  {
    key:         'agrow_employees',
    name:        'Field Workers',
    category:    'Field Ops',
    description: 'Crew and field employee management with badge tracking',
    icon:        '👷',
    default:     false,
  },
  {
    key:         'agrow_custom_fields',
    name:        'Field Custom Attributes',
    category:    'Field Ops',
    description: 'Extend field data models with custom attributes (text, number, dropdown, image)',
    icon:        '🌱',
    default:     false,
  },
  {
    key:         'agrow_languages',
    name:        'Languages',
    category:    'Field Ops',
    description: 'Multilingual support for field operations',
    icon:        '🌐',
    default:     false,
  },
];

/** Ordered category list — controls display order in the superadmin Modules panel */
export const CATEGORIES = [
  'Staffing',
  'Consulting',
  'Finance',
  'Analytics',
  'Workforce',
  'Compliance',
  'Portals',
  'AI',
  'Field Ops',
];

/** Convenience: map of key → module definition */
export const MODULE_MAP = Object.fromEntries(MODULE_REGISTRY.map(m => [m.key, m]));
