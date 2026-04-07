/**
 * AIChatWidget — floating AI assistant panel
 *
 * Features:
 *  - Floating trigger button (bottom-right)
 *  - Slide-up chat panel with conversation history sidebar
 *  - Markdown-like message rendering (bold, code, tables, lists)
 *  - Voice input via Web Speech API
 *  - Tool result cards (employees, invoices, headcount, etc.)
 *  - Multi-turn conversations stored per tenant
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api';
import { useModules } from '../contexts/ModulesContext';

// ── Tiny markdown renderer ────────────────────────────────────────────────────

function renderMarkdown(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const elements = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading
    if (line.startsWith('### ')) {
      elements.push(<h4 key={key++} className="font-semibold text-gray-900 mt-3 mb-1 text-sm">{line.slice(4)}</h4>);
      i++; continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<h3 key={key++} className="font-bold text-gray-900 mt-3 mb-1 text-sm">{line.slice(3)}</h3>);
      i++; continue;
    }
    if (line.startsWith('# ')) {
      elements.push(<h2 key={key++} className="font-bold text-gray-900 mt-3 mb-1 text-base">{line.slice(2)}</h2>);
      i++; continue;
    }

    // Table
    if (line.startsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const rows = tableLines.filter(l => !l.replace(/[\s|:-]/g, '').length === 0);
      const parsedRows = rows
        .filter(l => !l.match(/^\|[\s:-]+\|/))
        .map(l => l.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).map(c => c.trim()));
      if (parsedRows.length) {
        elements.push(
          <div key={key++} className="overflow-x-auto my-2">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>{parsedRows[0].map((h, j) => (
                  <th key={j} className="border border-gray-200 bg-gray-50 px-2 py-1 text-left font-semibold text-gray-700">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {parsedRows.slice(1).map((row, ri) => (
                  <tr key={ri} className="even:bg-gray-50/50">
                    {row.map((cell, ci) => (
                      <td key={ci} className="border border-gray-200 px-2 py-1 text-gray-700">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    // Code block
    if (line.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      elements.push(
        <pre key={key++} className="bg-gray-800 text-green-300 rounded-lg p-3 text-xs overflow-x-auto my-2 font-mono">
          {codeLines.join('\n')}
        </pre>
      );
      continue;
    }

    // Bullet list
    if (line.match(/^[-*] /)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <ul key={key++} className="list-disc list-inside space-y-0.5 my-1 text-sm text-gray-700">
          {items.map((item, j) => <li key={j}>{inlineFormat(item)}</li>)}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (line.match(/^\d+\. /)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(lines[i].replace(/^\d+\. /, ''));
        i++;
      }
      elements.push(
        <ol key={key++} className="list-decimal list-inside space-y-0.5 my-1 text-sm text-gray-700">
          {items.map((item, j) => <li key={j}>{inlineFormat(item)}</li>)}
        </ol>
      );
      continue;
    }

    // Blank line
    if (!line.trim()) {
      elements.push(<div key={key++} className="h-1" />);
      i++; continue;
    }

    // Paragraph
    elements.push(<p key={key++} className="text-sm text-gray-800 leading-relaxed">{inlineFormat(line)}</p>);
    i++;
  }

  return elements;
}

function inlineFormat(text) {
  // Split by **bold**, `code`, then render
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="bg-gray-100 text-purple-700 px-1 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

// ── Tool data card ────────────────────────────────────────────────────────────

function ToolCard({ toolData }) {
  if (!toolData?.length) return null;
  const lastTool = toolData[toolData.length - 1];
  const { tool, result } = lastTool;

  const icon = {
    get_headcount: '👥', list_employees: '👤', list_clients: '🏢',
    get_timesheet_summary: '⏱️', get_absence_summary: '🏖️',
    get_revenue_report: '💰', create_employee: '✅', generate_invoice: '📄',
    send_report: '📊',
  }[tool] || '🔧';

  return (
    <div className="mt-2 text-xs bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-blue-700">
      <span className="font-medium">{icon} Action: {tool.replace(/_/g, ' ')}</span>
      {result?.success === false && <span className="ml-2 text-red-600">{result.error}</span>}
      {result?.success === true && <span className="ml-2 text-green-700">✓ Success</span>}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';
  const toolData = msg.tool_data ? (typeof msg.tool_data === 'string' ? JSON.parse(msg.tool_data) : msg.tool_data) : null;

  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white text-xs shrink-0 mt-0.5">
          🤖
        </div>
      )}
      <div className={`max-w-[85%] ${isUser ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm px-3.5 py-2.5' : 'bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-3.5 py-2.5 shadow-sm'}`}>
        {isUser
          ? <p className="text-sm">{msg.content}</p>
          : (
            <div>
              {renderMarkdown(msg.content)}
              {toolData && <ToolCard toolData={toolData} />}
            </div>
          )
        }
        <p className={`text-xs mt-1 ${isUser ? 'text-blue-200' : 'text-gray-400'} text-right`}>
          {new Date(msg.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs shrink-0 mt-0.5">
          👤
        </div>
      )}
    </div>
  );
}

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-2 mb-3">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-white text-xs shrink-0">🤖</div>
      <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
        <div className="flex gap-1 items-center h-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Suggestion chips ──────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'Show me my headcount',
  'List all employees',
  'Pending timesheet approvals',
  'Create a new employee',
  'Generate an invoice',
  'Show this month\'s revenue',
];

// ── Main widget component ─────────────────────────────────────────────────────

export default function AIChatWidget() {
  const { hasModule } = useModules();
  const [open, setOpen]               = useState(false);
  const [messages, setMessages]       = useState([]);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [convId, setConvId]           = useState(null);
  const [conversations, setConvList]  = useState([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [configured, setConfigured]   = useState(true);
  const [listening, setListening]     = useState(false);
  const [speechSupported]             = useState(() => 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
  const recognitionRef                = useRef(null);
  const messagesEndRef                = useRef(null);
  const inputRef                      = useRef(null);

  if (!hasModule('ai_assistant')) return null;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => { if (open) scrollToBottom(); }, [messages, loading, open, scrollToBottom]);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!open) return;
    api.get('/api/ai-chat/config').then(r => setConfigured(r.data.configured)).catch(() => setConfigured(false));
    loadConversations();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (open && messages.length === 0 && !convId) inputRef.current?.focus();
  }, [open, messages.length, convId]);

  function loadConversations() {
    api.get('/api/ai-chat/conversations').then(r => setConvList(r.data)).catch(() => {});
  }

  function startNewChat() {
    setConvId(null);
    setMessages([]);
    setShowSidebar(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  async function loadConversation(id) {
    try {
      const r = await api.get(`/api/ai-chat/conversations/${id}`);
      setConvId(r.data.id);
      setMessages(r.data.messages || []);
      setShowSidebar(false);
    } catch {}
  }

  async function deleteConversation(id, e) {
    e.stopPropagation();
    await api.delete(`/api/ai-chat/conversations/${id}`);
    loadConversations();
    if (convId === id) startNewChat();
  }

  async function sendMessage(text = input) {
    const msg = text.trim();
    if (!msg || loading) return;
    setInput('');

    const userMsg = { role: 'user', content: msg, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const r = await api.post('/api/ai-chat/message', { message: msg, conversationId: convId });
      const aiMsg = {
        role: 'assistant',
        content: r.data.message,
        tool_data: r.data.toolData || null,
        created_at: new Date().toISOString(),
      };
      setConvId(r.data.conversationId);
      setMessages(prev => [...prev, aiMsg]);
      loadConversations();
    } catch (err) {
      const errText = err.response?.data?.error || 'Something went wrong. Please try again.';
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${errText}`, created_at: new Date().toISOString() }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function startVoice() {
    if (!speechSupported) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recog = new SpeechRecognition();
    recog.continuous = false;
    recog.interimResults = false;
    recog.lang = 'en-US';
    recog.onstart = () => setListening(true);
    recog.onend   = () => setListening(false);
    recog.onerror = () => setListening(false);
    recog.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript || '';
      if (transcript) {
        setInput(transcript);
        setTimeout(() => sendMessage(transcript), 100);
      }
    };
    recognitionRef.current = recog;
    recog.start();
  }

  function stopVoice() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  return (
    <>
      {/* Floating trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-br from-purple-600 to-blue-600 text-white rounded-full shadow-2xl hover:shadow-purple-300 hover:scale-105 transition-all z-40 flex items-center justify-center text-2xl"
        title="AI Assistant"
      >
        {open ? '✕' : '🤖'}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 w-[420px] h-[600px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col z-40 overflow-hidden"
          style={{ maxHeight: 'calc(100vh - 120px)' }}>

          {/* Header */}
          <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-3 flex items-center justify-between text-white shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xl">🤖</span>
              <div>
                <p className="font-semibold text-sm">HireIQ Assistant</p>
                <p className="text-xs text-purple-200">Ask anything about your data</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowSidebar(s => !s)} title="Chat history"
                className="p-1.5 rounded-lg hover:bg-white/20 transition-colors text-sm">🕒</button>
              <button onClick={startNewChat} title="New chat"
                className="p-1.5 rounded-lg hover:bg-white/20 transition-colors text-sm">✏️</button>
            </div>
          </div>

          {/* Body */}
          <div className="flex flex-1 min-h-0">
            {/* Sidebar */}
            {showSidebar && (
              <div className="w-48 border-r border-gray-100 flex flex-col shrink-0 bg-gray-50">
                <p className="px-3 py-2 text-xs font-semibold text-gray-500 border-b border-gray-100">Recent Chats</p>
                <div className="flex-1 overflow-y-auto">
                  {conversations.length === 0
                    ? <p className="px-3 py-4 text-xs text-gray-400 text-center">No chats yet</p>
                    : conversations.map(c => (
                        <div key={c.id}
                          onClick={() => loadConversation(c.id)}
                          className={`group flex items-center gap-1 px-3 py-2 cursor-pointer hover:bg-gray-100 text-xs border-b border-gray-50 ${c.id === convId ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
                        >
                          <span className="flex-1 truncate">{c.title}</span>
                          <button onClick={(e) => deleteConversation(c.id, e)}
                            className="shrink-0 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all">×</button>
                        </div>
                      ))
                  }
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Not configured banner */}
              {!configured && (
                <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-700 shrink-0">
                  ⚠️ Set <code className="font-mono">ANTHROPIC_API_KEY</code> in server env to enable AI responses.
                </div>
              )}

              {/* Messages area */}
              <div className="flex-1 overflow-y-auto px-4 py-4">
                {messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center">
                    <div className="text-4xl mb-3">🤖</div>
                    <p className="font-semibold text-gray-800 text-sm mb-1">Hi! I'm your HireIQ Assistant</p>
                    <p className="text-gray-500 text-xs mb-4 max-w-xs">Ask me about employees, timesheets, absences, or let me help you create records.</p>
                    <div className="flex flex-wrap gap-1.5 justify-center">
                      {SUGGESTIONS.map(s => (
                        <button key={s}
                          onClick={() => sendMessage(s)}
                          className="text-xs bg-gray-100 hover:bg-blue-50 hover:text-blue-700 border border-gray-200 rounded-full px-2.5 py-1 transition-colors text-gray-600">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
                {loading && <TypingIndicator />}
                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              <div className="border-t border-gray-100 px-3 py-3 shrink-0">
                <div className={`flex items-end gap-2 bg-gray-50 border ${listening ? 'border-red-400 ring-2 ring-red-100' : 'border-gray-200'} rounded-xl px-3 py-2 transition-colors`}>
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={listening ? 'Listening…' : 'Ask anything or say a command…'}
                    rows={1}
                    disabled={loading || listening}
                    className="flex-1 text-sm bg-transparent resize-none outline-none text-gray-800 placeholder-gray-400 min-h-[24px] max-h-28 leading-6"
                    style={{ height: 'auto' }}
                    onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
                  />
                  <div className="flex gap-1.5 items-center shrink-0 pb-0.5">
                    {speechSupported && (
                      <button
                        onClick={listening ? stopVoice : startVoice}
                        disabled={loading}
                        className={`p-1.5 rounded-lg transition-all text-base ${listening ? 'text-red-500 bg-red-50 animate-pulse' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}
                        title={listening ? 'Stop recording' : 'Voice input'}
                      >
                        🎤
                      </button>
                    )}
                    <button
                      onClick={() => sendMessage()}
                      disabled={!input.trim() || loading}
                      className="p-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-700 transition-colors text-sm"
                      title="Send"
                    >
                      ➤
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1 text-center">Enter to send · Shift+Enter for newline</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
