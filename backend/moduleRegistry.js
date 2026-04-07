/**
 * aGrow Module Registry
 *
 * Single source of truth for all licensable modules.
 * Super admins toggle these per tenant via the platform admin UI.
 */

const MODULE_REGISTRY = [
  // ── aGrow Agricultural ─────────────────────────────────────────────────────
  {
    key:         'agrow_scan',
    name:        'Field Scan',
    category:    'aGrow',
    description: 'Barcode + camera scanning in the field with offline-first support',
    icon:        '📷',
    default:     true,
  },
  {
    key:         'agrow_scanned_products',
    name:        'Scanned Products',
    category:    'aGrow',
    description: 'View and manage all field scan records',
    icon:        '🌾',
    default:     true,
  },
  {
    key:         'agrow_analytics',
    name:        'Harvest Analytics',
    category:    'aGrow',
    description: 'Production metrics, daily trend charts, and crew performance analysis',
    icon:        '📈',
    default:     true,
  },
  {
    key:         'agrow_employees',
    name:        'Field Workers',
    category:    'aGrow',
    description: 'Crew and field employee management with badge tracking',
    icon:        '👷',
    default:     true,
  },
  {
    key:         'agrow_custom_fields',
    name:        'Custom Fields',
    category:    'aGrow',
    description: 'Extend any data model with custom attributes (text, number, dropdown, image)',
    icon:        '🔧',
    default:     true,
  },
  {
    key:         'agrow_languages',
    name:        'Languages',
    category:    'aGrow',
    description: 'Multilingual support for field operations',
    icon:        '🌐',
    default:     true,
  },

  // ── Staffing / HR ──────────────────────────────────────────────────────────
  {
    key:         'hr_candidates',
    name:        'Candidates',
    category:    'Staffing',
    description: 'Candidate profiles, placement tracking, and hourly rate management',
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
    description: 'Leave requests, absence tracking, and approval',
    icon:        '🏖️',
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
    description: 'Document storage, e-signatures (single, two-way, three-way)',
    icon:        '📁',
    default:     true,
  },
  {
    key:         'hr_reports',
    name:        'Reports',
    category:    'Staffing',
    description: 'Hours, absence, and revenue reports with date-range filtering',
    icon:        '📉',
    default:     true,
  },
  {
    key:         'hr_import',
    name:        'CSV Import',
    category:    'Staffing',
    description: 'Bulk import candidates, clients, and time entries from CSV',
    icon:        '📥',
    default:     false,
  },
  {
    key:         'client_portal',
    name:        'Client Portal',
    category:    'Staffing',
    description: 'Self-service portal for clients to view invoices and approve timesheets',
    icon:        '🔗',
    default:     true,
  },

  // ── Support ────────────────────────────────────────────────────────────────
  {
    key:         'hr_support',
    name:        'Support Tickets',
    category:    'Support',
    description: 'In-app support ticketing — employees and clients raise tickets, admins manage and respond',
    icon:        '🎫',
    default:     true,
  },

  // ── AI Assistant ───────────────────────────────────────────────────────────
  {
    key:         'ai_assistant',
    name:        'AI Assistant',
    category:    'AI',
    description: 'Conversational AI — ask questions about your data, create employees, generate invoices, and more via text or voice',
    icon:        '🤖',
    default:     false,
  },
];

// Helper: return a set of default-enabled module keys
function defaultModuleKeys() {
  return MODULE_REGISTRY.filter(m => m.default).map(m => m.key);
}

// Helper: return a map of key → module definition
function moduleMap() {
  return Object.fromEntries(MODULE_REGISTRY.map(m => [m.key, m]));
}

module.exports = { MODULE_REGISTRY, defaultModuleKeys, moduleMap };
