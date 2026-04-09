import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// ── Service Worker registration & update handling ─────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {

      // A new SW has been found and is installing
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing
        if (!newWorker) return

        newWorker.addEventListener('statechange', () => {
          // New SW installed and waiting — prompt the user to reload
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner(newWorker)
          }
        })
      })

    }).catch(err => {
      console.warn('[SW] Registration failed:', err)
    })

    // When SW_ACTIVATED fires, the new SW is live — reload to get fresh assets
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'SW_ACTIVATED') {
        console.log(`[SW] Version ${event.data.version} activated — reloading for fresh assets`)
        window.location.reload()
      }
    })
  })
}

/**
 * Show a non-intrusive top banner prompting the user to accept the update.
 * Styled inline so it renders before any CSS chunks load.
 */
function showUpdateBanner(worker) {
  if (document.getElementById('sw-update-banner')) return  // no duplicates

  const banner = document.createElement('div')
  banner.id = 'sw-update-banner'
  banner.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
    'background:#059669', 'color:#fff',
    'display:flex', 'align-items:center', 'justify-content:center', 'gap:12px',
    'padding:10px 16px', 'font-size:14px', 'font-family:inherit',
    'box-shadow:0 2px 8px rgba(0,0,0,.25)',
  ].join(';')

  const msg = document.createElement('span')
  msg.textContent = '✨ A new version of Flow is available.'

  const btn = document.createElement('button')
  btn.textContent = 'Reload to update'
  btn.style.cssText = [
    'background:#fff', 'color:#059669', 'border:none', 'border-radius:6px',
    'padding:5px 14px', 'font-weight:600', 'cursor:pointer', 'font-size:13px',
  ].join(';')
  btn.addEventListener('click', () => {
    worker.postMessage({ type: 'SKIP_WAITING' })  // triggers SW activation
    banner.remove()
  })

  const dismiss = document.createElement('button')
  dismiss.textContent = '✕'
  dismiss.setAttribute('aria-label', 'Dismiss update notification')
  dismiss.style.cssText = [
    'background:transparent', 'color:#fff', 'border:none',
    'font-size:16px', 'cursor:pointer', 'padding:2px 8px',
  ].join(';')
  dismiss.addEventListener('click', () => banner.remove())

  banner.append(msg, btn, dismiss)
  document.body.prepend(banner)
}
