/**
 * HireIQ — ID Document Template Library
 *
 * Each country entry defines:
 *   - Supported ID types (passport, drivers_license, national_id, etc.)
 *   - Field extraction regex patterns specific to that country's document layout
 *   - Date format used on that country's documents
 *   - MRZ presence (passports always have MRZ; some national IDs do too)
 *   - Tesseract language hints
 *
 * Used by the OCR pipeline to apply country-aware field extraction
 * on top of raw Tesseract text output.
 *
 * To add a new country:
 *   1. Add an entry below in TEMPLATES
 *   2. Add at least one id_type with name patterns and field regexes
 *   3. Set dateFormat to the format used on that country's documents
 */

'use strict';

// ── Template schema ────────────────────────────────────────────────────────────
// Each template.idTypes[key] can have:
//   names    — strings to detect in OCR text that identify this doc type
//   fields   — map of fieldName → { regex, group }
//   dateFormat — 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'DD MMM YYYY' | 'YYMMDD'
//   hasMrz   — boolean (MRZ parser runs first when true)
//   tessLang — tesseract language string (default: 'eng')

const TEMPLATES = {

  // ── Australia ───────────────────────────────────────────────────────────────
  AU: {
    countryName: 'Australia',
    tessLang: 'eng',
    idTypes: {
      drivers_license: {
        names: ['DRIVER LICENCE', 'DRIVER LICENSE', 'DRIVING LICENCE', 'TRANSPORT FOR NSW', 'VICROADS', 'TRANSPORT WA'],
        dateFormat: 'DD/MM/YYYY',
        hasMrz: false,
        fields: {
          id_number:     { regex: /LICENCE\s+(?:NO\.?|NUMBER)[:\s]+([A-Z0-9]+)/i,            group: 1 },
          last_name:     { regex: /(?:SURNAME|FAMILY\s+NAME)[:\s]+([A-Z][A-Z\s\-']+)/i,     group: 1 },
          first_name:    { regex: /(?:GIVEN\s+NAMES?|FIRST\s+NAME)[:\s]+([A-Z][A-Z\s\-']+)/i, group: 1 },
          date_of_birth: { regex: /(?:DOB|DATE\s+OF\s+BIRTH|BIRTH\s+DATE)[:\s]+(\d{2}[\/-]\d{2}[\/-]\d{4})/i, group: 1 },
          expiry_date:   { regex: /(?:EXPIRY|EXPIRES?)[:\s]+(\d{2}[\/-]\d{2}[\/-]\d{4})/i,  group: 1 },
          address_line1: { regex: /(?:ADDRESS)[:\s]+([^\n]+)/i,                              group: 1 },
          state:         { regex: /\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/,                     group: 1 },
          gender:        { regex: /\b(MALE|FEMALE|M|F)\b(?!\s*NAME)/i,                      group: 1 },
        },
      },
      passport: {
        names: ['PASSPORT', 'AUSTRALIA', 'AUSTRALIAN PASSPORT'],
        dateFormat: 'DD MMM YYYY',
        hasMrz: true,
        fields: {
          id_number:     { regex: /PASSPORT\s+(?:NO\.?|NUMBER)[:\s]+([A-Z0-9]+)/i,           group: 1 },
          last_name:     { regex: /(?:SURNAME|FAMILY\s+NAME)[:\s]+([A-Z][A-Z\s]+)/i,        group: 1 },
          first_name:    { regex: /(?:GIVEN\s+NAMES?)[:\s]+([A-Z][A-Z\s]+)/i,               group: 1 },
          date_of_birth: { regex: /(?:DATE\s+OF\s+BIRTH|DOB)[:\s]+(\d{2}\s+\w+\s+\d{4})/i, group: 1 },
          expiry_date:   { regex: /(?:DATE\s+OF\s+EXPIRY|EXPIRY)[:\s]+(\d{2}\s+\w+\s+\d{4})/i, group: 1 },
          nationality:   { regex: /NATIONALITY[:\s]+(AUSTRALIAN|[A-Z]+)/i,                   group: 1 },
          gender:        { regex: /SEX[:\s]+([MF])/i,                                        group: 1 },
        },
      },
    },
  },

  // ── United Kingdom ──────────────────────────────────────────────────────────
  GB: {
    countryName: 'United Kingdom',
    tessLang: 'eng',
    idTypes: {
      drivers_license: {
        names: ['DRIVING LICENCE', 'DVLA', 'GB', 'UNITED KINGDOM'],
        dateFormat: 'DD/MM/YYYY',
        hasMrz: false,
        fields: {
          id_number:     { regex: /(?:LICENCE\s+NO\.?|DLN)[:\s]+([A-Z0-9]+)/i,               group: 1 },
          last_name:     { regex: /^([A-Z]+)\s*,/m,                                           group: 1 },
          first_name:    { regex: /,\s*([A-Z][A-Z\s]+)\s+\d/,                                group: 1 },
          date_of_birth: { regex: /(\d{2}[\/-]\d{2}[\/-]\d{4})\s+(?:to|–|-)\s+\d/i,         group: 1 },
          expiry_date:   { regex: /(?:to|–|-)\s+(\d{2}[\/-]\d{2}[\/-]\d{4})/i,               group: 1 },
          address_line1: { regex: /(?:ADDRESS)[:\s]+([^\n]+)/i,                               group: 1 },
          issuing_country: { regex: /(UNITED KINGDOM|GB)/i,                                   group: 1 },
        },
      },
      passport: {
        names: ['PASSPORT', 'UNITED KINGDOM', 'BRITISH PASSPORT'],
        dateFormat: 'DD MMM YYYY',
        hasMrz: true,
        fields: {
          id_number:     { regex: /PASSPORT\s+(?:NO\.?|NUMBER)\s+([A-Z0-9]+)/i,              group: 1 },
          last_name:     { regex: /(?:SURNAME)[:\s]+([A-Z][A-Z\s]+)/i,                       group: 1 },
          first_name:    { regex: /(?:GIVEN\s+NAMES?|FORENAMES?)[:\s]+([A-Z][A-Z\s]+)/i,    group: 1 },
          date_of_birth: { regex: /DATE\s+OF\s+BIRTH[:\s]+(\d{1,2}\s+\w+\s+\d{4})/i,        group: 1 },
          expiry_date:   { regex: /DATE\s+OF\s+EXPIRY[:\s]+(\d{1,2}\s+\w+\s+\d{4})/i,       group: 1 },
          nationality:   { regex: /NATIONALITY[:\s]+(BRITISH\s+CITIZEN|[A-Z\s]+)/i,          group: 1 },
        },
      },
    },
  },

  // ── United States ───────────────────────────────────────────────────────────
  US: {
    countryName: 'United States',
    tessLang: 'eng',
    idTypes: {
      drivers_license: {
        names: ["DRIVER'S LICENSE", "DRIVER LICENSE", "STATE ID", "IDENTIFICATION CARD", "DMV"],
        dateFormat: 'MM/DD/YYYY',
        hasMrz: false,
        fields: {
          id_number:     { regex: /(?:DL|LIC(?:ENSE)?|ID)\s*#?\s*([A-Z0-9]+)/i,              group: 1 },
          last_name:     { regex: /(?:LN|LAST\s+NAME|LNAME)[:\s]+([A-Z][A-Z\s\-']+)/i,       group: 1 },
          first_name:    { regex: /(?:FN|FIRST\s+NAME|FNAME)[:\s]+([A-Z][A-Z\s\-']+)/i,      group: 1 },
          date_of_birth: { regex: /(?:DOB|DATE\s+OF\s+BIRTH)[:\s]+(\d{2}[\/-]\d{2}[\/-]\d{4})/i, group: 1 },
          expiry_date:   { regex: /(?:EXP(?:IRES?)?|EXPIRATION)[:\s]+(\d{2}[\/-]\d{2}[\/-]\d{4})/i, group: 1 },
          address_line1: { regex: /(?:ADD(?:RESS)?)[:\s]+([^\n]+)/i,                         group: 1 },
          state:         { regex: /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/, group: 1 },
          gender:        { regex: /(?:SEX|GENDER)[:\s]+([MF])/i,                              group: 1 },
        },
      },
      passport: {
        names: ['UNITED STATES OF AMERICA', 'U.S.A.', 'U.S. PASSPORT'],
        dateFormat: 'DD MMM YYYY',
        hasMrz: true,
        fields: {
          id_number:     { regex: /PASSPORT\s+(?:NO\.?|NUMBER)\s+([A-Z0-9]+)/i,              group: 1 },
          last_name:     { regex: /(?:SURNAME|LAST\s+NAME)[:\s]+([A-Z][A-Z\s]+)/i,           group: 1 },
          first_name:    { regex: /(?:GIVEN\s+NAMES?|FIRST\s+NAME)[:\s]+([A-Z][A-Z\s]+)/i,  group: 1 },
          date_of_birth: { regex: /DATE\s+OF\s+BIRTH[:\s]+(\d{2}\s+\w+\s+\d{4})/i,          group: 1 },
          expiry_date:   { regex: /DATE\s+OF\s+EXPIRY[:\s]+(\d{2}\s+\w+\s+\d{4})/i,         group: 1 },
          nationality:   { regex: /NATIONALITY[:\s]+(U\.S\.\s*AMERICAN?|AMERICAN?|[A-Z\s]+)/i, group: 1 },
        },
      },
    },
  },

  // ── New Zealand ─────────────────────────────────────────────────────────────
  NZ: {
    countryName: 'New Zealand',
    tessLang: 'eng',
    idTypes: {
      drivers_license: {
        names: ['NEW ZEALAND', 'DRIVER LICENCE', 'NZTA'],
        dateFormat: 'DD/MM/YYYY',
        hasMrz: false,
        fields: {
          id_number:     { regex: /LICENCE\s+(?:NO\.?|NUMBER)[:\s]+([A-Z0-9]+)/i,            group: 1 },
          last_name:     { regex: /(?:SURNAME|FAMILY\s+NAME)[:\s]+([A-Z][A-Z\s\-']+)/i,     group: 1 },
          first_name:    { regex: /(?:GIVEN\s+NAMES?|FIRST\s+NAME)[:\s]+([A-Z][A-Z\s\-']+)/i, group: 1 },
          date_of_birth: { regex: /(?:DOB|DATE\s+OF\s+BIRTH)[:\s]+(\d{2}[\/-]\d{2}[\/-]\d{4})/i, group: 1 },
          expiry_date:   { regex: /(?:EXPIRY|EXPIRES?)[:\s]+(\d{2}[\/-]\d{2}[\/-]\d{4})/i,  group: 1 },
          address_line1: { regex: /(?:ADDRESS)[:\s]+([^\n]+)/i,                              group: 1 },
        },
      },
      passport: {
        names: ['NEW ZEALAND', 'AOTEAROA', 'NZL'],
        dateFormat: 'DD MMM YYYY',
        hasMrz: true,
        fields: {
          id_number:     { regex: /PASSPORT\s*(?:NO\.?|NUMBER)?[:\s]+([A-Z0-9]{6,9})/i,      group: 1 },
          last_name:     { regex: /(?:SURNAME|FAMILY\s+NAME)[:\s]+([A-Z][A-Z\s]+)/i,        group: 1 },
          first_name:    { regex: /(?:GIVEN\s+NAMES?)[:\s]+([A-Z][A-Z\s]+)/i,               group: 1 },
          date_of_birth: { regex: /DATE\s+OF\s+BIRTH[:\s]+(\d{2}\s+\w+\s+\d{4})/i,          group: 1 },
          expiry_date:   { regex: /DATE\s+OF\s+EXPIRY[:\s]+(\d{2}\s+\w+\s+\d{4})/i,         group: 1 },
        },
      },
    },
  },

  // ── India ───────────────────────────────────────────────────────────────────
  IN: {
    countryName: 'India',
    tessLang: 'eng',
    idTypes: {
      national_id: {
        names: ['AADHAAR', 'UNIQUE IDENTIFICATION', 'UIDAI'],
        dateFormat: 'DD/MM/YYYY',
        hasMrz: false,
        fields: {
          id_number:     { regex: /\b(\d{4}\s*\d{4}\s*\d{4})\b/,                            group: 1 },
          full_name:     { regex: /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)$/m,                    group: 1 },
          date_of_birth: { regex: /(?:DOB|Year of Birth|Date of Birth)[:\s]+(\d{2}\/\d{2}\/\d{4}|\d{4})/i, group: 1 },
          gender:        { regex: /\b(MALE|FEMALE|TRANSGENDER)\b/i,                          group: 1 },
          address_line1: { regex: /(?:Address|S\/O|D\/O|W\/O)[:\s]+([^\n]+)/i,              group: 1 },
        },
      },
      drivers_license: {
        names: ['DRIVING LICENCE', 'DL-', 'TRANSPORT DEPARTMENT'],
        dateFormat: 'DD/MM/YYYY',
        hasMrz: false,
        fields: {
          id_number:     { regex: /(?:DL\s*NO\.?|Licence\s*No\.?)[:\s]+([A-Z0-9\-]+)/i,     group: 1 },
          full_name:     { regex: /(?:Name)[:\s]+([A-Za-z][A-Za-z\s]+)/i,                    group: 1 },
          date_of_birth: { regex: /(?:DOB|D\.O\.B)[:\s]+(\d{2}[\/-]\d{2}[\/-]\d{4})/i,      group: 1 },
          expiry_date:   { regex: /(?:Valid Upto|Validity)[:\s]+(\d{2}[\/-]\d{2}[\/-]\d{4})/i, group: 1 },
          address_line1: { regex: /(?:Address|Add)[:\s]+([^\n]+)/i,                          group: 1 },
        },
      },
      passport: {
        names: ['REPUBLIC OF INDIA', 'PASSPORT', 'IND'],
        dateFormat: 'DD/MM/YYYY',
        hasMrz: true,
        fields: {
          id_number:     { regex: /[A-Z]\d{7}/,                                              group: 0 },
          last_name:     { regex: /(?:SURNAME|LAST\s+NAME)[:\s]+([A-Z][A-Z\s]+)/i,          group: 1 },
          first_name:    { regex: /(?:GIVEN\s+NAME|FIRST\s+NAME)[:\s]+([A-Z][A-Z\s]+)/i,   group: 1 },
          date_of_birth: { regex: /DATE\s+OF\s+BIRTH[:\s]+(\d{2}\/\d{2}\/\d{4})/i,          group: 1 },
          expiry_date:   { regex: /DATE\s+OF\s+EXPIRY[:\s]+(\d{2}\/\d{2}\/\d{4})/i,         group: 1 },
          nationality:   { regex: /NATIONALITY[:\s]+(INDIAN)/i,                              group: 1 },
        },
      },
    },
  },

  // ── Canada ──────────────────────────────────────────────────────────────────
  CA: {
    countryName: 'Canada',
    tessLang: 'eng+fra',
    idTypes: {
      drivers_license: {
        names: ["DRIVER'S LICENCE", "DRIVER'S LICENSE", "PERMIS DE CONDUIRE", "ONTARIO", "ALBERTA", "BRITISH COLUMBIA", "QUEBEC"],
        dateFormat: 'YYYY-MM-DD',
        hasMrz: false,
        fields: {
          id_number:     { regex: /(?:DL\s*(?:NO\.?|#)|LICENCE\s+NO\.?)[:\s]+([A-Z0-9\-]+)/i, group: 1 },
          last_name:     { regex: /(?:SURNAME|NOM DE FAMILLE|LAST\s+NAME)[:\s]+([A-Z][A-Z\s\-']+)/i, group: 1 },
          first_name:    { regex: /(?:GIVEN\s+NAMES?|PRENOM|FIRST\s+NAME)[:\s]+([A-Z][A-Z\s\-']+)/i, group: 1 },
          date_of_birth: { regex: /(?:DOB|DATE\s+OF\s+BIRTH|DATE\s+DE\s+NAISSANCE)[:\s]+(\d{4}-\d{2}-\d{2}|\d{2}[\/-]\d{2}[\/-]\d{4})/i, group: 1 },
          expiry_date:   { regex: /(?:EXPIRY|EXPIRATION)[:\s]+(\d{4}-\d{2}-\d{2}|\d{2}[\/-]\d{2}[\/-]\d{4})/i, group: 1 },
          address_line1: { regex: /(?:ADDRESS|ADRESSE)[:\s]+([^\n]+)/i,                     group: 1 },
        },
      },
      passport: {
        names: ['CANADA', 'CANADIAN PASSPORT', 'CAN'],
        dateFormat: 'DD MMM YYYY',
        hasMrz: true,
        fields: {
          id_number:     { regex: /PASSPORT\s*(?:NO\.?)[:\s]+([A-Z0-9]+)/i,                 group: 1 },
          last_name:     { regex: /(?:SURNAME|NOM)[:\s]+([A-Z][A-Z\s]+)/i,                  group: 1 },
          first_name:    { regex: /(?:GIVEN\s+NAMES?|PRENOM)[:\s]+([A-Z][A-Z\s]+)/i,       group: 1 },
          date_of_birth: { regex: /DATE\s+OF\s+BIRTH[:\s]+(\d{2}\s+\w+\s+\d{4})/i,         group: 1 },
          expiry_date:   { regex: /DATE\s+OF\s+EXPIRY[:\s]+(\d{2}\s+\w+\s+\d{4})/i,        group: 1 },
        },
      },
    },
  },

  // ── Singapore ───────────────────────────────────────────────────────────────
  SG: {
    countryName: 'Singapore',
    tessLang: 'eng',
    idTypes: {
      national_id: {
        names: ['NRIC', 'SINGAPORE', 'IDENTITY CARD', 'IC'],
        dateFormat: 'DD MMM YYYY',
        hasMrz: false,
        fields: {
          id_number:     { regex: /\b([STFG]\d{7}[A-Z])\b/,                                 group: 1 },
          full_name:     { regex: /^([A-Z][A-Z\s]+)$/m,                                     group: 1 },
          date_of_birth: { regex: /(?:DATE\s+OF\s+BIRTH|DOB)[:\s]+(\d{2}\s+\w+\s+\d{4})/i, group: 1 },
          gender:        { regex: /\b(MALE|FEMALE)\b/i,                                      group: 1 },
          address_line1: { regex: /(?:ADDRESS)[:\s]+([^\n]+)/i,                              group: 1 },
          country:       { regex: /(SINGAPORE)/i,                                            group: 1 },
          nationality:   { regex: /(?:RACE|NATIONALITY)[:\s]+([A-Z]+)/i,                     group: 1 },
        },
      },
      passport: {
        names: ['REPUBLIC OF SINGAPORE', 'SGP'],
        dateFormat: 'DD MMM YYYY',
        hasMrz: true,
        fields: {
          id_number:     { regex: /PASSPORT\s*(?:NO\.?)[:\s]+([A-Z0-9]+)/i,                 group: 1 },
          last_name:     { regex: /(?:SURNAME)[:\s]+([A-Z][A-Z\s]+)/i,                      group: 1 },
          first_name:    { regex: /(?:GIVEN\s+NAMES?)[:\s]+([A-Z][A-Z\s]+)/i,              group: 1 },
          date_of_birth: { regex: /DATE\s+OF\s+BIRTH[:\s]+(\d{2}\s+\w+\s+\d{4})/i,         group: 1 },
          expiry_date:   { regex: /DATE\s+OF\s+EXPIRY[:\s]+(\d{2}\s+\w+\s+\d{4})/i,        group: 1 },
        },
      },
    },
  },

  // ── UAE ─────────────────────────────────────────────────────────────────────
  AE: {
    countryName: 'United Arab Emirates',
    tessLang: 'eng',
    idTypes: {
      national_id: {
        names: ['UNITED ARAB EMIRATES', 'EMIRATES ID', 'IDENTITY CARD', 'ICA'],
        dateFormat: 'DD/MM/YYYY',
        hasMrz: false,
        fields: {
          id_number:     { regex: /(?:ID\s*NO\.?|I\.D\.?\s*NO\.?)[:\s]+(\d{3}-\d{4}-\d{7}-\d)/i, group: 1 },
          full_name:     { regex: /(?:NAME)[:\s]+([A-Za-z][A-Za-z\s]+)/i,                    group: 1 },
          date_of_birth: { regex: /(?:DATE\s+OF\s+BIRTH|DOB)[:\s]+(\d{2}\/\d{2}\/\d{4})/i,  group: 1 },
          expiry_date:   { regex: /(?:EXPIRY\s+DATE|DATE\s+OF\s+EXPIRY)[:\s]+(\d{2}\/\d{2}\/\d{4})/i, group: 1 },
          nationality:   { regex: /(?:NATIONALITY)[:\s]+([A-Z]+)/i,                           group: 1 },
          gender:        { regex: /(?:SEX|GENDER)[:\s]+([MF])/i,                              group: 1 },
        },
      },
      passport: {
        names: ['UNITED ARAB EMIRATES', 'ARE'],
        dateFormat: 'DD/MM/YYYY',
        hasMrz: true,
        fields: {
          id_number:     { regex: /PASSPORT\s*(?:NO\.?)[:\s]+([A-Z0-9]+)/i,                  group: 1 },
          full_name:     { regex: /(?:NAME)[:\s]+([A-Za-z][A-Za-z\s]+)/i,                    group: 1 },
          date_of_birth: { regex: /DATE\s+OF\s+BIRTH[:\s]+(\d{2}\/\d{2}\/\d{4})/i,           group: 1 },
          expiry_date:   { regex: /DATE\s+OF\s+EXPIRY[:\s]+(\d{2}\/\d{2}\/\d{4})/i,          group: 1 },
          nationality:   { regex: /NATIONALITY[:\s]+([A-Z\s]+)/i,                             group: 1 },
        },
      },
    },
  },

  // ── Philippines ─────────────────────────────────────────────────────────────
  PH: {
    countryName: 'Philippines',
    tessLang: 'eng',
    idTypes: {
      national_id: {
        names: ['PHILIPPINE IDENTIFICATION SYSTEM', 'PHILSYS', 'NATIONAL ID'],
        dateFormat: 'MM/DD/YYYY',
        hasMrz: false,
        fields: {
          id_number:     { regex: /(?:PSN|ID\s*NO\.?)[:\s]+(\d{4}-\d{7}-\d)/i,              group: 1 },
          full_name:     { regex: /(?:NAME)[:\s]+([A-Za-z][A-Za-z\s,]+)/i,                  group: 1 },
          date_of_birth: { regex: /(?:DATE\s+OF\s+BIRTH|BIRTHDATE)[:\s]+(\d{2}\/\d{2}\/\d{4})/i, group: 1 },
          gender:        { regex: /(?:SEX|GENDER)[:\s]+(MALE|FEMALE|M|F)/i,                  group: 1 },
          address_line1: { regex: /(?:ADDRESS|PERMANENT\s+ADDRESS)[:\s]+([^\n]+)/i,          group: 1 },
          country:       { regex: /(PHILIPPINES)/i,                                           group: 1 },
        },
      },
      passport: {
        names: ['REPUBLIC OF THE PHILIPPINES', 'PHL'],
        dateFormat: 'DD MMM YYYY',
        hasMrz: true,
        fields: {
          id_number:     { regex: /PASSPORT\s*(?:NO\.?)[:\s]+([A-Z0-9]+)/i,                 group: 1 },
          last_name:     { regex: /(?:SURNAME)[:\s]+([A-Z][A-Z\s]+)/i,                      group: 1 },
          first_name:    { regex: /(?:GIVEN\s+NAMES?)[:\s]+([A-Z][A-Z\s]+)/i,              group: 1 },
          date_of_birth: { regex: /DATE\s+OF\s+BIRTH[:\s]+(\d{2}\s+\w+\s+\d{4})/i,         group: 1 },
          expiry_date:   { regex: /DATE\s+OF\s+EXPIRY[:\s]+(\d{2}\s+\w+\s+\d{4})/i,        group: 1 },
        },
      },
    },
  },

  // ── Germany ─────────────────────────────────────────────────────────────────
  DE: {
    countryName: 'Germany',
    tessLang: 'deu',
    idTypes: {
      national_id: {
        names: ['PERSONALAUSWEIS', 'BUNDESREPUBLIK DEUTSCHLAND', 'IDENTITY CARD'],
        dateFormat: 'DD.MM.YYYY',
        hasMrz: true,
        fields: {
          id_number:     { regex: /(?:AUSWEIS-?NR\.?|CARD\s+NO\.?)[:\s]+([A-Z0-9]+)/i,      group: 1 },
          last_name:     { regex: /(?:NAME|NACHNAME)[:\s]+([A-ZÄÖÜ][A-ZÄÖÜ\s\-]+)/i,        group: 1 },
          first_name:    { regex: /(?:VORNAME|GIVEN\s+NAMES?)[:\s]+([A-ZÄÖÜ][A-ZÄÖÜ\s\-]+)/i, group: 1 },
          date_of_birth: { regex: /(?:GEBURTSDATUM|DATE\s+OF\s+BIRTH)[:\s]+(\d{2}\.\d{2}\.\d{4})/i, group: 1 },
          expiry_date:   { regex: /(?:GÜLTIG\s+BIS|EXPIRY)[:\s]+(\d{2}\.\d{2}\.\d{4})/i,   group: 1 },
          nationality:   { regex: /(?:STAATSANGEHÖRIGKEIT|NATIONALITY)[:\s]+([A-ZÄÖÜ]+)/i,  group: 1 },
          gender:        { regex: /(?:GESCHLECHT|SEX)[:\s]+([MFX])/i,                        group: 1 },
        },
      },
      passport: {
        names: ['REISEPASS', 'BUNDESREPUBLIK DEUTSCHLAND', 'DEU'],
        dateFormat: 'DD.MM.YYYY',
        hasMrz: true,
        fields: {
          id_number:     { regex: /(?:PASS-?NR\.?|PASSPORT\s*NO\.?)[:\s]+([A-Z0-9]+)/i,     group: 1 },
          last_name:     { regex: /(?:NAME|NACHNAME)[:\s]+([A-ZÄÖÜ][A-ZÄÖÜ\s\-]+)/i,        group: 1 },
          first_name:    { regex: /(?:VORNAME)[:\s]+([A-ZÄÖÜ][A-ZÄÖÜ\s\-]+)/i,              group: 1 },
          date_of_birth: { regex: /GEBURTSDATUM[:\s]+(\d{2}\.\d{2}\.\d{4})/i,               group: 1 },
          expiry_date:   { regex: /GÜLTIG\s+BIS[:\s]+(\d{2}\.\d{2}\.\d{4})/i,               group: 1 },
        },
      },
    },
  },

  // ── France ──────────────────────────────────────────────────────────────────
  FR: {
    countryName: 'France',
    tessLang: 'fra',
    idTypes: {
      national_id: {
        names: ["CARTE NATIONALE D'IDENTITE", "REPUBLIQUE FRANCAISE", 'CNI'],
        dateFormat: 'DD/MM/YYYY',
        hasMrz: true,
        fields: {
          id_number:     { regex: /(?:N°|NO\.?)[:\s]+([A-Z0-9]+)/i,                         group: 1 },
          last_name:     { regex: /(?:NOM)[:\s]+([A-ZÀÂÇÉÈÊËÎÏÔÙÛÜ][A-ZÀÂÇÉÈÊËÎÏÔÙÛÜ\s\-]+)/i, group: 1 },
          first_name:    { regex: /(?:PRENOM|PRÉNOM)[:\s]+([A-ZÀÂÇÉÈÊËÎÏÔÙÛÜ][A-Za-zàâçéèêëîïôùûü\s\-]+)/i, group: 1 },
          date_of_birth: { regex: /(?:NÉ\(E\)\s+LE|DATE\s+DE\s+NAISSANCE)[:\s]+(\d{2}[\/-]\d{2}[\/-]\d{4})/i, group: 1 },
          expiry_date:   { regex: /(?:DATE\s+D.EXPIRATION|VALIDE\s+JUSQU.AU)[:\s]+(\d{2}[\/-]\d{2}[\/-]\d{4})/i, group: 1 },
          gender:        { regex: /(?:SEXE|SEX)[:\s]+([MF])/i,                               group: 1 },
          nationality:   { regex: /(?:NATIONALITE|NATIONALITY)[:\s]+(FRANÇAISE?|FRENCH|[A-Z]+)/i, group: 1 },
        },
      },
      passport: {
        names: ['REPUBLIQUE FRANCAISE', 'PASSEPORT', 'FRA'],
        dateFormat: 'DD MMM YYYY',
        hasMrz: true,
        fields: {
          id_number:     { regex: /(?:N°\s+PASSEPORT|PASSPORT\s*NO\.?)[:\s]+([A-Z0-9]+)/i,  group: 1 },
          last_name:     { regex: /(?:NOM)[:\s]+([A-ZÀÂÇÉÈÊËÎÏÔÙÛÜ][A-ZÀÂÇÉÈÊËÎÏÔÙÛÜ\s]+)/i, group: 1 },
          first_name:    { regex: /(?:PRENOM|PRÉNOM)[:\s]+([A-Za-zàâçéèêëîïôùûü\s]+)/i,    group: 1 },
          date_of_birth: { regex: /DATE\s+DE\s+NAISSANCE[:\s]+(\d{2}\s+\w+\s+\d{4})/i,      group: 1 },
          expiry_date:   { regex: /DATE\s+D.EXPIRATION[:\s]+(\d{2}\s+\w+\s+\d{4})/i,        group: 1 },
        },
      },
    },
  },

  // ── South Africa ────────────────────────────────────────────────────────────
  ZA: {
    countryName: 'South Africa',
    tessLang: 'eng',
    idTypes: {
      national_id: {
        names: ['SOUTH AFRICA', 'REPUBLIC OF SOUTH AFRICA', 'IDENTITY DOCUMENT', 'SMART ID'],
        dateFormat: 'YYMMDD',
        hasMrz: false,
        fields: {
          // SA ID number: 13-digit YYMMDDGSSSCAZ
          id_number:     { regex: /\b(\d{6}\s?\d{4}\s?\d{3})\b/,                            group: 1 },
          full_name:     { regex: /(?:NAMES?|FULL\s+NAMES?)[:\s]+([A-Za-z][A-Za-z\s]+)/i,  group: 1 },
          last_name:     { regex: /(?:SURNAME)[:\s]+([A-Z][A-Z\s\-]+)/i,                    group: 1 },
          date_of_birth: { regex: /(?:DATE\s+OF\s+BIRTH|DOB)[:\s]+(\d{2}\s+\w+\s+\d{4}|\d{4}-\d{2}-\d{2})/i, group: 1 },
          gender:        { regex: /(?:SEX|GENDER)[:\s]+(MALE|FEMALE|M|F)/i,                  group: 1 },
          nationality:   { regex: /(?:NATIONALITY|CITIZEN)[:\s]+([A-Z\s]+)/i,               group: 1 },
          country:       { regex: /(SOUTH\s+AFRICA)/i,                                       group: 1 },
        },
      },
      passport: {
        names: ['REPUBLIC OF SOUTH AFRICA', 'ZAF'],
        dateFormat: 'DD MMM YYYY',
        hasMrz: true,
        fields: {
          id_number:     { regex: /PASSPORT\s*(?:NO\.?)[:\s]+([A-Z0-9]+)/i,                 group: 1 },
          last_name:     { regex: /(?:SURNAME)[:\s]+([A-Z][A-Z\s]+)/i,                      group: 1 },
          first_name:    { regex: /(?:GIVEN\s+NAMES?|FIRST\s+NAME)[:\s]+([A-Z][A-Z\s]+)/i, group: 1 },
          date_of_birth: { regex: /DATE\s+OF\s+BIRTH[:\s]+(\d{2}\s+\w+\s+\d{4})/i,         group: 1 },
          expiry_date:   { regex: /DATE\s+OF\s+EXPIRY[:\s]+(\d{2}\s+\w+\s+\d{4})/i,        group: 1 },
        },
      },
    },
  },

};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect the best matching country + ID type from raw OCR text.
 * Returns { countryCode, idType, template } or null.
 */
function detectTemplate(ocrText) {
  const upper = ocrText.toUpperCase();
  let bestMatch = null;
  let bestScore = 0;

  for (const [countryCode, country] of Object.entries(TEMPLATES)) {
    for (const [idType, tpl] of Object.entries(country.idTypes)) {
      const score = tpl.names.reduce((s, name) =>
        upper.includes(name.toUpperCase()) ? s + 1 : s, 0);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { countryCode, idType, template: tpl, tessLang: country.tessLang };
      }
    }
  }

  return bestScore > 0 ? bestMatch : null;
}

/**
 * Apply a template's field regexes to raw OCR text.
 * Returns a partial fields object — only fields that matched.
 */
function applyTemplate(ocrText, templateMatch) {
  if (!templateMatch) return {};
  const { template } = templateMatch;
  const extracted = { id_type: templateMatch.idType };

  for (const [field, rule] of Object.entries(template.fields)) {
    const match = ocrText.match(rule.regex);
    if (match && match[rule.group]) {
      let value = match[rule.group].trim().replace(/\s+/g, ' ');
      // Normalise gender
      if (field === 'gender') {
        const g = value.toUpperCase();
        value = g === 'M' ? 'male' : g === 'F' ? 'female' : g === 'MALE' ? 'male' : g === 'FEMALE' ? 'female' : null;
      }
      // Normalise state (uppercase)
      if (field === 'state') value = value.toUpperCase();
      if (value) extracted[field] = value;
    }
  }

  // Build full_name from parts if not already set
  if (!extracted.full_name && (extracted.first_name || extracted.last_name)) {
    extracted.full_name = [extracted.first_name, extracted.last_name].filter(Boolean).join(' ');
  }

  // Attach country info
  const country = Object.values(TEMPLATES).find(c =>
    Object.keys(c.idTypes).some((_, i) => Object.keys(c.idTypes)[i] === templateMatch.idType)
  );
  extracted.issuing_country = TEMPLATES[templateMatch.countryCode]?.countryName || null;
  extracted.country         = TEMPLATES[templateMatch.countryCode]?.countryName || null;

  // Capture date format for the calling normaliser
  extracted._dateFormat = template.dateFormat;
  extracted._hasMrz     = template.hasMrz;

  return extracted;
}

/**
 * Get the Tesseract language string for a given country code.
 * Defaults to 'eng'.
 */
function getTessLang(countryCode) {
  return TEMPLATES[countryCode]?.tessLang || 'eng';
}

/**
 * Returns all supported countries + ID types for the admin UI.
 */
function getSupportedDocuments() {
  return Object.entries(TEMPLATES).map(([code, c]) => ({
    countryCode: code,
    countryName: c.countryName,
    idTypes: Object.entries(c.idTypes).map(([type, tpl]) => ({
      type,
      names: tpl.names,
      dateFormat: tpl.dateFormat,
      hasMrz: tpl.hasMrz,
      fieldCount: Object.keys(tpl.fields).length,
    })),
  }));
}

module.exports = { detectTemplate, applyTemplate, getTessLang, getSupportedDocuments, TEMPLATES };
