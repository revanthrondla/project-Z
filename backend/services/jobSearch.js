/**
 * C2C Job Search Service
 *
 * Uses JSearch API (via RapidAPI) to search for Corp-to-Corp job postings
 * matching a candidate's skills and role. Results are cached in the tenant's
 * c2c_job_cache table for 2 hours.
 *
 * Required ENV:
 *   JSEARCH_API_KEY  — RapidAPI key for jsearch.p.rapidapi.com
 *
 * If JSEARCH_API_KEY is not set, returns mock results so dev works without a key.
 */

const https = require('node:https');
const crypto = require('crypto');

const JSEARCH_HOST = 'jsearch.p.rapidapi.com';
const CACHE_TTL_HOURS = 2;

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers,
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Extract a concise search query from a candidate's resume skills + role.
 * Returns something like: "JavaScript React Node.js corp to corp C2C"
 */
function buildSearchQuery(candidateRole, skills = []) {
  // Take top 5 skills to keep query focused
  const topSkills = skills.slice(0, 5).join(' ');
  const base = [candidateRole, topSkills].filter(Boolean).join(' ');
  return `${base} "corp to corp" OR "C2C" OR "contract to contract"`;
}

/**
 * Fetch C2C jobs from JSearch API for a given query.
 * Returns array of normalised job objects.
 */
async function fetchFromJSearch(query) {
  const apiKey = process.env.JSEARCH_API_KEY;
  if (!apiKey) {
    console.warn('[JobSearch] JSEARCH_API_KEY not set — returning mock data');
    return getMockJobs(query);
  }

  const encodedQuery = encodeURIComponent(query);
  const url = `https://${JSEARCH_HOST}/search?query=${encodedQuery}&page=1&num_pages=2&date_posted=month`;

  const response = await httpsGet(url, {
    'X-RapidAPI-Key': apiKey,
    'X-RapidAPI-Host': JSEARCH_HOST,
  });

  if (response.statusCode !== 200) {
    console.error('[JobSearch] JSearch API error:', response.statusCode, response.body.slice(0, 200));
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    console.error('[JobSearch] Failed to parse JSearch response');
    return [];
  }

  const jobs = (parsed.data || []).map((j) => ({
    id:           j.job_id,
    title:        j.job_title,
    company:      j.employer_name,
    location:     [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', '),
    isRemote:     !!j.job_is_remote,
    applyLink:    j.job_apply_link,
    description:  (j.job_description || '').slice(0, 500),
    postedAt:     j.job_posted_at_datetime_utc,
    source:       j.job_publisher || 'JSearch',
    employerLogo: j.employer_logo,
    salary:       j.job_salary_currency
      ? `${j.job_salary_currency} ${j.job_min_salary || ''}–${j.job_max_salary || ''}`.trim()
      : null,
  }));

  // Filter to ensure C2C relevance (API might return non-C2C results)
  return jobs.filter((j) => {
    const text = (j.title + ' ' + j.description).toLowerCase();
    return (
      text.includes('corp to corp') ||
      text.includes('c2c') ||
      text.includes('contract to contract') ||
      text.includes('1099') ||
      text.includes('w2')
    );
  });
}

/**
 * Search for C2C jobs with caching.
 * @param {object} db - tenant db wrapper
 * @param {string} candidateRole - job title/role of the candidate
 * @param {string[]} skills - array of skill strings from resume
 * @returns {Promise<{jobs: object[], fromCache: boolean, query: string}>}
 */
async function searchC2CJobs(db, candidateRole, skills = []) {
  const query = buildSearchQuery(candidateRole, skills);
  const hash = crypto.createHash('sha256').update(query).digest('hex');

  // Check cache first
  try {
    const cacheResult = await db.query(
      `SELECT results, result_count FROM c2c_job_cache
       WHERE search_hash = $1 AND expires_at > NOW()`,
      [hash]
    );
    if (cacheResult.rows[0]) {
      const cached = cacheResult.rows[0];
      const results = typeof cached.results === 'string'
        ? JSON.parse(cached.results)
        : cached.results;
      return { jobs: results, fromCache: true, query };
    }
  } catch (err) {
    console.warn('[JobSearch] Cache read error:', err.message);
  }

  // Fetch fresh results
  const jobs = await fetchFromJSearch(query);

  // Store in cache
  try {
    const expiresAt = new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000);
    await db.query(
      `INSERT INTO c2c_job_cache (search_hash, query, results, result_count, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (search_hash) DO UPDATE SET
         results = EXCLUDED.results,
         result_count = EXCLUDED.result_count,
         created_at = NOW(),
         expires_at = EXCLUDED.expires_at`,
      [hash, query, JSON.stringify(jobs), jobs.length, expiresAt]
    );
  } catch (err) {
    console.warn('[JobSearch] Cache write error:', err.message);
  }

  return { jobs, fromCache: false, query };
}

/**
 * Extract skills from a candidate_resumes record.
 */
function extractSkillsFromResume(resume) {
  if (!resume) return [];
  let skills = resume.skills || [];
  if (typeof skills === 'string') {
    try { skills = JSON.parse(skills); } catch { skills = []; }
  }
  // skills can be [{name: 'JS', ...}] or ['JS', ...]
  return skills
    .map((s) => (typeof s === 'string' ? s : s.name || s.skill || ''))
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * Mock data for development (no API key needed).
 */
function getMockJobs(query) {
  return [
    {
      id: 'mock-1',
      title: 'Senior Software Engineer - C2C/Corp to Corp',
      company: 'TechStaff Solutions',
      location: 'New York, NY, US',
      isRemote: true,
      applyLink: 'https://www.dice.com/jobs/detail/mock1',
      description: 'Looking for an experienced engineer for a corp to corp engagement. 6-month contract with possible extension...',
      postedAt: new Date(Date.now() - 86400000).toISOString(),
      source: 'Dice',
      employerLogo: null,
      salary: 'USD 80–120/hr',
    },
    {
      id: 'mock-2',
      title: 'Full Stack Developer - Corp to Corp Only',
      company: 'NovaTech Staffing',
      location: 'Austin, TX, US',
      isRemote: true,
      applyLink: 'https://www.linkedin.com/jobs/view/mock2',
      description: 'C2C contract role. Must have own LLC/S-Corp. 12-month initial term...',
      postedAt: new Date(Date.now() - 172800000).toISOString(),
      source: 'LinkedIn',
      employerLogo: null,
      salary: 'USD 90–130/hr',
    },
    {
      id: 'mock-3',
      title: 'Cloud Solutions Architect - C2C Contract',
      company: 'Apex Talent Group',
      location: 'Remote',
      isRemote: true,
      applyLink: 'https://www.indeed.com/viewjob?jk=mock3',
      description: 'Seeking Cloud Architect for corp to corp contract. AWS/Azure experience required. Rate negotiable...',
      postedAt: new Date(Date.now() - 43200000).toISOString(),
      source: 'Indeed',
      employerLogo: null,
      salary: null,
    },
  ];
}

module.exports = { searchC2CJobs, extractSkillsFromResume, buildSearchQuery };
