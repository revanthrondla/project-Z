import axios from 'axios';

const api = axios.create({
  baseURL: '',
  headers: { 'Content-Type': 'application/json' },
  // Required so the browser sends the httpOnly session cookie on every request.
  withCredentials: true,
});

// Response interceptor: redirect to /login on 401, but only when it makes sense.
// Guards:
//   1. Don't redirect if we're already on /login — avoids a hard-reload loop
//      caused by the AuthContext /me check firing 401 on the login page itself.
//   2. Don't redirect for the login POST itself — let the catch in handleSubmit
//      surface the error to the user.
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      const onLoginPage   = window.location.pathname === '/login';
      const isLoginCall   = err.config?.url?.includes('/api/auth/login');
      if (!onLoginPage && !isLoginCall) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
