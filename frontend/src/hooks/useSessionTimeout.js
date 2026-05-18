/**
 * useSessionTimeout — SOC 2 CC6.1 Session inactivity timeout
 *
 * Monitors user activity (mouse, keyboard, touch, scroll).
 * After IDLE_MINUTES of no activity, shows a 60-second warning modal,
 * then auto-logs out and redirects to /login.
 *
 * Also sends a heartbeat every HEARTBEAT_INTERVAL ms. If the server returns
 * 401 (token revoked or expired), the user is immediately logged out.
 *
 * Usage: call useSessionTimeout() inside a component that is always mounted
 * when the user is logged in (e.g. Layout.jsx or App.jsx).
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

const IDLE_MINUTES        = 30;
const IDLE_MS             = IDLE_MINUTES * 60 * 1000;
const WARNING_BEFORE_MS   = 60 * 1000;   // show warning 1 minute before logout
const HEARTBEAT_INTERVAL  = 5 * 60 * 1000; // 5 minutes

export function useSessionTimeout(isLoggedIn) {
  const navigate      = useNavigate();
  const lastActivity  = useRef(Date.now());
  const idleTimer     = useRef(null);
  const heartbeatRef  = useRef(null);
  const [showWarning, setShowWarning] = useState(false);
  const [countdown,   setCountdown]   = useState(60);
  const countdownRef  = useRef(null);

  const doLogout = useCallback(async () => {
    setShowWarning(false);
    clearInterval(countdownRef.current);
    clearTimeout(idleTimer.current);
    clearInterval(heartbeatRef.current);
    try {
      await api.post('/api/auth/logout');
    } catch {}
    localStorage.removeItem('hireiq_user');
    navigate('/login?reason=session_timeout', { replace: true });
    window.location.reload();
  }, [navigate]);

  const resetTimer = useCallback(() => {
    if (!isLoggedIn) return;
    lastActivity.current = Date.now();

    // If warning modal is showing and user moves, dismiss it and reset
    if (showWarning) {
      setShowWarning(false);
      clearInterval(countdownRef.current);
    }

    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      // Show warning for last 60 seconds
      setShowWarning(true);
      setCountdown(60);
      countdownRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownRef.current);
            doLogout();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, IDLE_MS - WARNING_BEFORE_MS);
  }, [isLoggedIn, showWarning, doLogout]);

  useEffect(() => {
    if (!isLoggedIn) return;

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();

    // Heartbeat — detect server-side revocation or expiry
    heartbeatRef.current = setInterval(async () => {
      try {
        await api.post('/api/auth/heartbeat');
      } catch (err) {
        if (err.response?.status === 401) {
          doLogout();
        }
      }
    }, HEARTBEAT_INTERVAL);

    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      clearTimeout(idleTimer.current);
      clearInterval(heartbeatRef.current);
      clearInterval(countdownRef.current);
    };
  }, [isLoggedIn, resetTimer, doLogout]);

  return { showWarning, countdown, stayLoggedIn: resetTimer, logout: doLogout };
}
