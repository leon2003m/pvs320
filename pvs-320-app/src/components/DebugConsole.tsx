import React, { useState, useEffect } from 'react';
import { bleService, BLELog } from '../services/bleService';
import { Terminal, Trash2, ChevronDown, ChevronUp, Clock, Send, Download } from 'lucide-react';

export default function DebugConsole() {
  const [logs, setLogs] = useState<BLELog[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [serverLoggingEnabled, setServerLoggingEnabled] = useState(bleService.isServerLoggingEnabled());

  useEffect(() => {
    void bleService.loadLogs();
    const unsubscribe = bleService.onLogsUpdate((newLogs) => {
      setLogs([...newLogs]);
    });
    return unsubscribe;
  }, []);

  const getLogColor = (type: BLELog['type']) => {
    switch (type) {
      case 'send': return 'text-blue-400';
      case 'receive': return 'text-green-400';
      case 'error': return 'text-red-400';
      default: return 'text-slate-400';
    }
  };

  const getLogIcon = (type: BLELog['type']) => {
    switch (type) {
      case 'send': return <Send className="w-3 h-3" />;
      case 'receive': return <Download className="w-3 h-3" />;
      default: return <Clock className="w-3 h-3" />;
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 max-w-md mx-auto px-4">
      <div className={`bg-slate-950 border-x border-t border-slate-800 rounded-t-2xl shadow-2xl transition-all duration-300 ${isOpen ? 'h-[400px]' : 'h-12'}`}>
        {/* Header */}
        <div 
          onClick={() => setIsOpen(!isOpen)}
          className="h-12 flex items-center justify-between px-4 cursor-pointer border-b border-slate-900"
        >
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">Debug Console</span>
            <span className="px-1.5 py-0.5 bg-slate-800 rounded text-[10px] text-slate-500 font-mono">
              {logs.length}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const next = !serverLoggingEnabled;
                setServerLoggingEnabled(next);
                bleService.setServerLoggingEnabled(next);
              }}
              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                serverLoggingEnabled
                  ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40'
                  : 'bg-slate-800 text-slate-500 border border-slate-700'
              }`}
            >
              WEB {serverLoggingEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                bleService.clearLogs();
              }}
              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-500 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            {isOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronUp className="w-4 h-4 text-slate-500" />}
          </div>
        </div>

        {/* Log List */}
        {isOpen && (
          <div className="h-[352px] overflow-y-auto p-4 font-mono text-[10px] space-y-2 bg-slate-950">
            {logs.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-600 italic">
                No logs yet. Connect to a device to see traffic.
              </div>
            ) : (
              logs.map((log, i) => (
                <div key={log.timestamp + i} className="flex gap-3 border-b border-slate-900/50 pb-2">
                  <span className="text-slate-600 shrink-0">
                    {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <div className="flex gap-2 min-w-0">
                    <span className={`${getLogColor(log.type)} shrink-0 mt-0.5`}>
                      {getLogIcon(log.type)}
                    </span>
                    <span className={`${getLogColor(log.type)} break-all whitespace-pre-wrap`}>
                      {log.message}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
