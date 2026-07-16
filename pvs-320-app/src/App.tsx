import React, { useState, useEffect } from 'react';
import { bleService } from './services/bleService';
import { DeviceStatus } from './types';
import AuthScreen from './screens/AuthScreen';
import ControlTab from './components/ControlTab';
import SettingsTab from './components/SettingsTab';
import DebugConsole from './components/DebugConsole';
import { Sliders, Settings, Info, AlertTriangle, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [activeTab, setActiveTab] = useState<'control' | 'settings'>('control');
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastIsError, setToastIsError] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [headerClicks, setHeaderClicks] = useState(0);
  const shownAuthToast = React.useRef<string | null>(null);

  useEffect(() => {
    if (headerClicks === 3) {
      setShowDebug(true);
      setHeaderClicks(0);
    }
    const timer = setTimeout(() => setHeaderClicks(0), 1000);
    return () => clearTimeout(timer);
  }, [headerClicks]);

  useEffect(() => {
    const unsubscribe = bleService.onStatusUpdate((newStatus) => {
      setStatus(newStatus ? { ...newStatus } : null);
      
      const msg = newStatus?.lastErrorMessage || newStatus?.lastResponse;
      if (!msg) return;

      const lowerMsg = msg.toLowerCase();
      const isAuthMsg = lowerMsg.includes('authenticated');
      const isOkMsg = lowerMsg.startsWith('ok ');
      const isSuccessMsg = isAuthMsg || isOkMsg || !newStatus?.lastErrorMessage;
      
      if (isSuccessMsg && shownAuthToast.current === msg) return;
      if (isSuccessMsg) shownAuthToast.current = msg;

      setToastMsg(msg);
      setToastIsError(!!newStatus?.lastErrorMessage);
      setShowToast(true);
      const timer = setTimeout(() => setShowToast(false), 3000);
      return () => clearTimeout(timer);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!status?.authenticated) {
      shownAuthToast.current = null;
    }
  }, [status?.authenticated]);

  if (!status?.authenticated) {
    return (
      <>
        <AuthScreen onShowDebug={() => setShowDebug(true)} />
        {showDebug && <DebugConsole />}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col max-w-md mx-auto relative overflow-hidden shadow-2xl">
      {/* Header */}
      <header className="px-6 pt-8 pb-4 bg-slate-950/80 backdrop-blur-md sticky top-0 z-20 flex justify-between items-center border-b border-slate-900">
        <div onClick={() => setHeaderClicks(prev => prev + 1)} className="cursor-default">
          <h1 className="text-xl font-bold tracking-tight">Thermal Controller</h1>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Live Link Active</span>
          </div>
        </div>
        <button
          onClick={() => { void bleService.disconnect(); }}
          aria-label="Log out and disconnect"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-red-600 hover:text-white hover:border-red-500 transition-colors text-xs font-semibold"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-6 pt-6 overflow-y-auto custom-scrollbar">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: activeTab === 'control' ? -10 : 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: activeTab === 'control' ? 10 : -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'control' ? <ControlTab /> : <SettingsTab />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Toast Notification */}
      <AnimatePresence>
        {showToast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-24 left-6 right-6 z-50"
          >
            <div className={`text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 border ${toastIsError ? 'bg-red-600 border-red-400/30' : 'bg-blue-600 border-blue-400/30'}`}>
              {toastIsError ? <AlertTriangle className="w-5 h-5 flex-shrink-0" /> : <Info className="w-5 h-5 flex-shrink-0" />}
              <p className="text-sm font-medium">{toastMsg}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tab Bar */}
      <nav className="bg-slate-900/90 backdrop-blur-xl border-t border-slate-800 px-8 py-4 flex justify-around items-center sticky bottom-0 z-20">
        <button 
          onClick={() => setActiveTab('control')}
          className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'control' ? 'text-blue-500 scale-110' : 'text-slate-500 hover:text-slate-300'}`}
        >
          <Sliders className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-tighter">Control</span>
        </button>
        <button 
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'settings' ? 'text-blue-500 scale-110' : 'text-slate-500 hover:text-slate-300'}`}
        >
          <Settings className="w-6 h-6" />
          <span className="text-[10px] font-bold uppercase tracking-tighter">Settings</span>
        </button>
      </nav>

      {showDebug && <DebugConsole />}

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #1e293b;
          border-radius: 10px;
        }
      `}} />
    </div>
  );
}
