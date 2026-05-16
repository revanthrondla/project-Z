/**
 * SessionTimeoutModal — shown 60 seconds before automatic logout
 */
export default function SessionTimeoutModal({ countdown, onStayLoggedIn, onLogout }) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center">
        <div className="text-5xl mb-4">⏱️</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Session expiring soon</h2>
        <p className="text-gray-500 text-sm mb-6">
          You've been inactive for a while. You'll be automatically logged out in:
        </p>
        <div className="text-5xl font-mono font-bold text-red-500 mb-6">
          {countdown}s
        </div>
        <div className="flex gap-3">
          <button
            onClick={onLogout}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm font-medium"
          >
            Log out now
          </button>
          <button
            onClick={onStayLoggedIn}
            className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
          >
            Stay logged in
          </button>
        </div>
      </div>
    </div>
  );
}
