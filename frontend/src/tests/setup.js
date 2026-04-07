/**
 * Vitest global setup — runs before each test FILE.
 *
 * Starts MSW (Mock Service Worker) in Node mode so all axios/fetch calls
 * made by React components are intercepted without any real network traffic.
 *
 * Individual tests can override specific handlers via:
 *   server.use(http.get('/api/auth/me', () => HttpResponse.json({ ... })))
 *
 * The server resets its handlers after each test to avoid cross-test pollution.
 */
import { setupServer } from 'msw/node';
import { handlers } from './handlers/index.js';
import '@testing-library/jest-dom';

// Create the server with the default handlers
export const server = setupServer(...handlers);

// Start intercepting before all tests in this file
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));

// Restore handler overrides after each test
afterEach(() => server.resetHandlers());

// Clean up after the last test in the file
afterAll(() => server.close());
