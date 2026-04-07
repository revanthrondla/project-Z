/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['./tests/setup.js'],
  clearMocks: true,
  restoreMocks: true,
  verbose: true,
  // Collect coverage from source files, not test helpers
  collectCoverageFrom: [
    'middleware/**/*.js',
    'routes/**/*.js',
    'services/**/*.js',
    '!routes/agrow.js',      // out of scope for this test suite
    '!routes/resumes.js',
    '!routes/documents.js',
  ],
  coverageReporters: ['text', 'lcov'],
};
