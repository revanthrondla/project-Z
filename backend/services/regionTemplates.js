/**
 * HireIQ — Regional (State / Province) ID Template Extensions
 *
 * Each entry refines the parent country template with:
 *   - State / province identification strings
 *   - State-specific ID number regex (most states have unique formats)
 *   - State-specific field overrides / extras
 *
 * Consumed by idTemplates.js — call getRegionTemplate(countryCode, regionCode)
 * to get merged field rules that override the country-level template.
 *
 * Adding a new region:
 *   1. Find the correct country block below
 *   2. Add an entry keyed by the state/province code
 *   3. Provide at least `names` (detection strings) and `id_number` regex
 */

'use strict';

// ── United States — all 50 states + DC ─────────────────────────────────────
// US DL number formats vary widely by state. Sources: AAMVA DL/ID Card Design
// Standard. Date format is always MM/DD/YYYY on all US DLs.
//
// id_number regex: state-specific alphanumeric format
// names:           text that uniquely appears on that state's document
// issuer:          official issuing authority name (for extra detection)

const US_STATES = {
  AL: { names: ['ALABAMA'],          id_number: /\b(\d{7,8})\b/,                     issuer: 'DEPARTMENT OF PUBLIC SAFETY' },
  AK: { names: ['ALASKA'],           id_number: /\b(\d{7})\b/,                        issuer: 'DIVISION OF MOTOR VEHICLES' },
  AZ: { names: ['ARIZONA'],          id_number: /\b([A-Z]\d{8}|\d{9})\b/,            issuer: '' },
  AR: { names: ['ARKANSAS'],         id_number: /\b(\d{9})\b/,                        issuer: '' },
  CA: { names: ['CALIFORNIA'],       id_number: /\b([A-Z]\d{7})\b/,                  issuer: 'DMV' },
  CO: { names: ['COLORADO'],         id_number: /\b(\d{9}|[A-Z]\d{3}-\d{3}-\d{2})\b/, issuer: '' },
  CT: { names: ['CONNECTICUT'],      id_number: /\b(\d{9})\b/,                        issuer: '' },
  DE: { names: ['DELAWARE'],         id_number: /\b(\d{1,7})\b/,                      issuer: '' },
  FL: { names: ['FLORIDA'],          id_number: /\b([A-Z]\d{12})\b/,                  issuer: 'HIGHWAY SAFETY AND MOTOR VEHICLES' },
  GA: { names: ['GEORGIA'],          id_number: /\b(\d{9})\b/,                        issuer: '' },
  HI: { names: ['HAWAII'],           id_number: /\b([A-Z]\d{8})\b/,                   issuer: '' },
  ID: { names: ['IDAHO'],            id_number: /\b([A-Z]{2}\d{6}[A-Z]?)\b/,          issuer: '' },
  IL: { names: ['ILLINOIS'],         id_number: /\b([A-Z]\d{11,12})\b/,               issuer: '' },
  IN: { names: ['INDIANA'],          id_number: /\b([A-Z]\d{9}|\d{10})\b/,            issuer: '' },
  IA: { names: ['IOWA'],             id_number: /\b(\d{9}|[A-Z]{3}\d{6})\b/,          issuer: '' },
  KS: { names: ['KANSAS'],           id_number: /\b([A-Z]\d{8}|\d{9})\b/,             issuer: '' },
  KY: { names: ['KENTUCKY'],         id_number: /\b([A-Z]\d{8,9})\b/,                 issuer: '' },
  LA: { names: ['LOUISIANA'],        id_number: /\b(\d{9})\b/,                         issuer: '' },
  ME: { names: ['MAINE'],            id_number: /\b(\d{7})\b/,                         issuer: '' },
  MD: { names: ['MARYLAND'],         id_number: /\b([A-Z]\d{12})\b/,                   issuer: 'MVA' },
  MA: { names: ['MASSACHUSETTS'],    id_number: /\b([A-Z]\d{8})\b/,                    issuer: 'RMV' },
  MI: { names: ['MICHIGAN'],         id_number: /\b([A-Z]\d{12})\b/,                   issuer: '' },
  MN: { names: ['MINNESOTA'],        id_number: /\b([A-Z]\d{12})\b/,                   issuer: '' },
  MS: { names: ['MISSISSIPPI'],      id_number: /\b(\d{9})\b/,                         issuer: '' },
  MO: { names: ['MISSOURI'],         id_number: /\b([A-Z]\d{5,9}|\d{9})\b/,           issuer: '' },
  MT: { names: ['MONTANA'],          id_number: /\b(\d{9}|[A-Z]\d{8})\b/,             issuer: '' },
  NE: { names: ['NEBRASKA'],         id_number: /\b([A-Z]\d{6,8})\b/,                 issuer: '' },
  NV: { names: ['NEVADA'],           id_number: /\b(\d{10}|[A-Z]\d{9}|[A-Z]{3}-\d{2}-\d{4})\b/, issuer: '' },
  NH: { names: ['NEW HAMPSHIRE'],    id_number: /\b(\d{2}[A-Z]{3}\d{5})\b/,           issuer: '' },
  NJ: { names: ['NEW JERSEY'],       id_number: /\b([A-Z]\d{14})\b/,                  issuer: 'MVC' },
  NM: { names: ['NEW MEXICO'],       id_number: /\b(\d{9})\b/,                         issuer: '' },
  NY: { names: ['NEW YORK'],         id_number: /\b(\d{9})\b/,                         issuer: 'DMV' },
  NC: { names: ['NORTH CAROLINA'],   id_number: /\b(\d{12})\b/,                        issuer: '' },
  ND: { names: ['NORTH DAKOTA'],     id_number: /\b([A-Z]{3}\d{6}|\d{9})\b/,          issuer: '' },
  OH: { names: ['OHIO'],             id_number: /\b([A-Z]{2}\d{6})\b/,                 issuer: '' },
  OK: { names: ['OKLAHOMA'],         id_number: /\b([A-Z]\d{9}|\d{9})\b/,             issuer: '' },
  OR: { names: ['OREGON'],           id_number: /\b([A-Z]\d{6,7}|\d{7})\b/,           issuer: '' },
  PA: { names: ['PENNSYLVANIA'],     id_number: /\b(\d{8})\b/,                         issuer: 'PENNDOT' },
  RI: { names: ['RHODE ISLAND'],     id_number: /\b(\d{7}|[A-Z]{2}\d{6})\b/,          issuer: '' },
  SC: { names: ['SOUTH CAROLINA'],   id_number: /\b(\d{5,11})\b/,                      issuer: '' },
  SD: { names: ['SOUTH DAKOTA'],     id_number: /\b(\d{6,10}|[A-Z]{1,2}\d{6,7})\b/,  issuer: '' },
  TN: { names: ['TENNESSEE'],        id_number: /\b(\d{7,9})\b/,                       issuer: '' },
  TX: { names: ['TEXAS'],            id_number: /\b(\d{8})\b/,                         issuer: 'DPS' },
  UT: { names: ['UTAH'],             id_number: /\b(\d{4,10})\b/,                      issuer: '' },
  VT: { names: ['VERMONT'],          id_number: /\b(\d{7,8}[A-Z]?)\b/,                issuer: '' },
  VA: { names: ['VIRGINIA'],         id_number: /\b([A-Z]\d{8}|\d{9})\b/,             issuer: 'DMV' },
  WA: { names: ['WASHINGTON'],       id_number: /\b([A-Z]{3,7}\*\*[A-Z0-9]{6}|[A-Z]{5,7}\d{3}[A-Z]{2}\d)\b/, issuer: '' },
  WV: { names: ['WEST VIRGINIA'],    id_number: /\b([A-Z]\d{6}|\d{7})\b/,             issuer: '' },
  WI: { names: ['WISCONSIN'],        id_number: /\b([A-Z]\d{13})\b/,                   issuer: '' },
  WY: { names: ['WYOMING'],          id_number: /\b(\d{9,10})\b/,                      issuer: '' },
  DC: { names: ['DISTRICT OF COLUMBIA','WASHINGTON DC'], id_number: /\b(\d{7})\b/,    issuer: '' },
};

// ── Australia — 8 states / territories ──────────────────────────────────────
// AU DL formats vary by state. Date format: DD/MM/YYYY on all AU DLs.

const AU_STATES = {
  NSW: { names: ['NEW SOUTH WALES','NSW','TRANSPORT FOR NSW'],
         id_number: /\b(\d{8})\b/,         issuer: 'TRANSPORT FOR NSW' },
  VIC: { names: ['VICTORIA','VIC','VICROADS'],
         id_number: /\b(\d{9,10})\b/,      issuer: 'VICROADS' },
  QLD: { names: ['QUEENSLAND','QLD'],
         id_number: /\b(\d{8,9})\b/,       issuer: 'DEPARTMENT OF TRANSPORT AND MAIN ROADS' },
  WA:  { names: ['WESTERN AUSTRALIA','WA','TRANSPORT WA'],
         id_number: /\b(\d{7})\b/,         issuer: 'DEPARTMENT OF TRANSPORT' },
  SA:  { names: ['SOUTH AUSTRALIA','SA','SERVICE SA'],
         id_number: /\b([A-Z]\d{6})\b/,    issuer: 'SERVICE SA' },
  TAS: { names: ['TASMANIA','TAS'],
         id_number: /\b(\d{6,7})\b/,       issuer: 'SERVICE TASMANIA' },
  ACT: { names: ['AUSTRALIAN CAPITAL TERRITORY','ACT','ACCESS CANBERRA'],
         id_number: /\b(\d{6,7})\b/,       issuer: 'ACCESS CANBERRA' },
  NT:  { names: ['NORTHERN TERRITORY','NT'],
         id_number: /\b(\d{6,7})\b/,       issuer: 'DEPARTMENT OF INFRASTRUCTURE' },
};

// ── Canada — 13 provinces / territories ─────────────────────────────────────
// CA DL formats are very distinct per province. Date format varies.

const CA_PROVINCES = {
  ON: { names: ['ONTARIO','ServiceOntario'],
        id_number: /\b([A-Z]\d{4}-\d{5}-\d{5})\b/,   dateFormat: 'YYYY/MM/DD', issuer: 'ServiceOntario' },
  BC: { names: ['BRITISH COLUMBIA','BC','ICBC'],
        id_number: /\b(\d{7})\b/,                      dateFormat: 'YYYY/MM/DD', issuer: 'ICBC' },
  AB: { names: ['ALBERTA','AB'],
        id_number: /\b(\d{9})\b/,                      dateFormat: 'YYYY-MM-DD', issuer: '' },
  QC: { names: ['QUÉBEC','QUEBEC','QC','SAAQ'],
        id_number: /\b([A-Z]\d{4}-\d{6}-\d{2})\b/,   dateFormat: 'YYYY-MM-DD', issuer: 'SAAQ', tessLang: 'fra+eng' },
  MB: { names: ['MANITOBA','MB'],
        id_number: /\b([A-Z]{2}-?\d{3}-?\d{3})\b/,   dateFormat: 'YYYY/MM/DD', issuer: '' },
  SK: { names: ['SASKATCHEWAN','SK'],
        id_number: /\b(\d{8})\b/,                      dateFormat: 'YYYY/MM/DD', issuer: '' },
  NS: { names: ['NOVA SCOTIA','NS'],
        id_number: /\b([A-Z]{5}-\d{9})\b/,            dateFormat: 'DD/MM/YYYY', issuer: '' },
  NB: { names: ['NEW BRUNSWICK','NB'],
        id_number: /\b(\d{7})\b/,                      dateFormat: 'DD/MM/YYYY', issuer: '' },
  NL: { names: ['NEWFOUNDLAND','LABRADOR','NL'],
        id_number: /\b([A-Z]\d{9})\b/,                dateFormat: 'DD/MM/YYYY', issuer: '' },
  PE: { names: ['PRINCE EDWARD ISLAND','PEI','PE'],
        id_number: /\b(\d{6})\b/,                      dateFormat: 'DD/MM/YYYY', issuer: '' },
  NT: { names: ['NORTHWEST TERRITORIES','NT'],
        id_number: /\b(\d{6})\b/,                      dateFormat: 'DD/MM/YYYY', issuer: '' },
  YT: { names: ['YUKON','YT'],
        id_number: /\b(\d{6})\b/,                      dateFormat: 'DD/MM/YYYY', issuer: '' },
  NU: { names: ['NUNAVUT','NU'],
        id_number: /\b(\d{6})\b/,                      dateFormat: 'DD/MM/YYYY', issuer: '' },
};

// ── Public exports ────────────────────────────────────────────────────────────

const REGIONS = { US: US_STATES, AU: AU_STATES, CA: CA_PROVINCES };

/**
 * Get the list of region codes for a country (for the UI picker).
 * Returns null if the country has no region data.
 */
function getRegionCodes(countryCode) {
  const regions = REGIONS[countryCode?.toUpperCase()];
  if (!regions) return null;
  return Object.entries(regions).map(([code, r]) => ({
    code,
    name: r.names[0],   // primary display name
    names: r.names,
  }));
}

/**
 * Auto-detect the state/province from OCR text for a given country.
 * Returns { regionCode, region } or null.
 */
function detectRegion(countryCode, ocrText) {
  const regions = REGIONS[countryCode?.toUpperCase()];
  if (!regions) return null;
  const upper = ocrText.toUpperCase();
  for (const [code, r] of Object.entries(regions)) {
    if (r.names.some(n => upper.includes(n.toUpperCase()))) {
      return { regionCode: code, region: r };
    }
  }
  return null;
}

/**
 * Given a base template and an optional regionCode (or auto-detect),
 * return merged field rules with region-specific id_number regex applied.
 */
function applyRegion(baseTemplate, countryCode, regionCode, ocrText) {
  const regions = REGIONS[countryCode?.toUpperCase()];
  if (!regions) return baseTemplate;

  let region;
  if (regionCode && regions[regionCode.toUpperCase()]) {
    region = regions[regionCode.toUpperCase()];
  } else if (ocrText) {
    const detected = detectRegion(countryCode, ocrText);
    if (detected) {
      region = detected.region;
      regionCode = detected.regionCode;
    }
  }
  if (!region) return baseTemplate;

  // Deep-clone the base template so we don't mutate it
  const merged = JSON.parse(JSON.stringify(baseTemplate,
    // regex objects don't JSON-serialise — handle specially
    (key, val) => val instanceof RegExp ? { __regexp: val.source, __flags: val.flags } : val
  ));
  // Restore RegExp objects
  const restore = (obj) => {
    for (const k of Object.keys(obj)) {
      if (obj[k] && typeof obj[k] === 'object') {
        if (obj[k].__regexp) {
          obj[k] = new RegExp(obj[k].__regexp, obj[k].__flags);
        } else {
          restore(obj[k]);
        }
      }
    }
  };
  restore(merged);

  // Override id_number regex with the state-specific one
  if (region.id_number) {
    merged.fields.id_number = { regex: region.id_number, group: 1 };
  }
  // Override dateFormat if the region specifies one (e.g. QC uses YYYY-MM-DD)
  if (region.dateFormat) {
    merged.dateFormat = region.dateFormat;
  }
  // Add tessLang override (e.g. QC uses fra+eng)
  if (region.tessLang) {
    merged._tessLangOverride = region.tessLang;
  }
  // Add region name strings to the detection names list
  merged.names = [...(merged.names || []), ...region.names];
  merged._regionCode   = regionCode;
  merged._regionName   = region.names[0];
  merged._issuer       = region.issuer || null;

  return merged;
}

module.exports = { REGIONS, getRegionCodes, detectRegion, applyRegion };
