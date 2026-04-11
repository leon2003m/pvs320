import React, { useState, useEffect } from 'react';
import { bleService, ConnectionState } from '../services/bleService';
import { DeviceStatus } from '../types';
import { Bluetooth, Lock, ShieldCheck, AlertCircle, Loader2, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import BLETest from '../components/BLETest';

export default function AuthScreen({ onShowDebug }: { onShowDebug?: () => void }) {
  const [state, setState] = useState<ConnectionState>('disconnected');
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [password, setPassword] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isMock, setIsMock] = useState(bleService.isMock);
  const [logoClicks, setLogoClicks] = useState(0);
  const [showMockToggle, setShowMockToggle] = useState(bleService.isMock);

  useEffect(() => {
    if (logoClicks === 3) {
      setShowMockToggle(true);
      onShowDebug?.();
      setLogoClicks(0);
    }
    const timer = setTimeout(() => setLogoClicks(0), 1000);
    return () => clearTimeout(timer);
  }, [logoClicks]);

  useEffect(() => {
    const unsubscribe = bleService.onStatusUpdate((newStatus) => {
      setStatus({ ...newStatus });
      setState(bleService.state);
      
      if (newStatus.lastResponse || newStatus.lastErrorMessage || newStatus.authenticated) {
        setIsAuthenticating(false);
      }
    });
    return unsubscribe;
  }, []);

  const toggleMock = () => {
    const next = !isMock;
    setIsMock(next);
    bleService.setMock(next);
  };

  const handleConnect = async () => {
    try {
      await bleService.scanAndConnect();
      setState(bleService.state);
    } catch (error) {
      console.error(error);
      setState('error');
    }
  };

  const handleAuth = async () => {
    if (!password) return;
    setIsAuthenticating(true);
    
    try {
      if (status) {
        setStatus({ ...status, lastErrorMessage: '', lastErrorCode: '', lastResponse: '' });
      }
      await bleService.login(password);
    } catch (error) {
      console.error("Auth send failed:", error);
      setIsAuthenticating(false);
    }
  };

  const getFriendlyErrorMessage = (msg: string) => {
    if (!msg) return null;
    
    // Clean up messages that might contain JSON fragments
    let cleanMsg = msg;
    if (msg.includes('{')) {
      cleanMsg = msg.split('{')[0].trim();
    }
    
    if (!cleanMsg || cleanMsg.startsWith('OK')) return null;

    const lower = cleanMsg.toLowerCase();
    if (lower.includes('err pas') || lower.includes('invalid password') || lower.includes('wrong password')) {
      return 'Incorrect Password. Please try again.';
    }
    if (lower.includes('err emp')) {
      return 'Empty password not allowed.';
    }
    return cleanMsg;
  };

  const rawMessage = status?.lastErrorMessage || status?.lastResponse || '';
  const errorMessage = rawMessage ? getFriendlyErrorMessage(rawMessage) : null;
  const isError = !!errorMessage;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md space-y-8 text-center"
      >
        <div className="flex justify-center">
          <div 
            onClick={() => setLogoClicks(prev => prev + 1)}
            className="p-4 bg-blue-600/20 rounded-full cursor-pointer active:scale-95 transition-transform"
          >
            <Bluetooth className="w-12 h-12 text-blue-500" />
          </div>
        </div>

        <div>
          <h1 className="text-3xl font-bold tracking-tight">Thermal Camera</h1>
          <p className="text-slate-400 mt-2">BLE Controller Interface</p>
        </div>

        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 space-y-6">
          {showMockToggle && (
            <div className="flex items-center justify-between p-3 bg-slate-950 rounded-xl border border-slate-800">
              <div className="flex items-center gap-2">
                <Zap className={`w-4 h-4 ${isMock ? 'text-amber-500' : 'text-green-500'}`} />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  {isMock ? 'Mock Mode' : 'Real BLE Mode'}
                </span>
              </div>
              <button 
                onClick={toggleMock}
                className={`w-10 h-5 rounded-full transition-colors relative ${isMock ? 'bg-amber-600' : 'bg-green-600'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${isMock ? 'left-0.5' : 'left-[22px]'}`} />
              </button>
            </div>
          )}

          {state === 'disconnected' && (
            <button
              onClick={handleConnect}
              className="w-full py-4 bg-blue-600 hover:bg-blue-500 transition-colors rounded-xl font-semibold flex items-center justify-center gap-2"
            >
              <Bluetooth className="w-5 h-5" />
              Scan & Connect
            </button>
          )}

          {(state === 'scanning' || state === 'connecting') && (
            <div className="flex flex-col items-center py-4 space-y-4">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-slate-300 font-medium">
                {state === 'scanning' ? 'Scanning for Bluetooth devices...' : 'Establishing Connection...'}
              </p>
            </div>
          )}

          {state === 'connected' && !status?.authenticated && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-500 justify-center mb-2">
                <ShieldCheck className="w-5 h-5" />
                <span className="font-medium text-sm uppercase tracking-wider">Connected</span>
              </div>
              
              <div className="space-y-2 text-left">
                <label className="text-xs font-semibold text-slate-500 uppercase ml-1">Device Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
              </div>

              <button
                onClick={handleAuth}
                disabled={isAuthenticating}
                className={`w-full py-4 transition-all rounded-xl font-semibold ${
                  isError
                    ? 'bg-red-600 hover:bg-red-500 shadow-[0_0_15px_rgba(220,38,38,0.4)]'
                    : 'bg-blue-600 hover:bg-blue-500'
                } disabled:opacity-50`}
              >
                {isAuthenticating ? 'Authenticating...' : 'Unlock Controller'}
              </button>

              {errorMessage && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ 
                    opacity: 1, 
                    y: 0,
                    x: isError ? [-2, 2, -2, 2, 0] : 0
                  }}
                  className="flex items-center gap-2 justify-center p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm font-medium text-red-400"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </motion.div>
              )}
            </div>
          )}

          {state === 'error' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-red-500 justify-center">
                <AlertCircle className="w-6 h-6" />
                <span className="font-bold">Connection Failed</span>
              </div>
              <button
                onClick={handleConnect}
                className="w-full py-4 bg-slate-800 hover:bg-slate-700 transition-colors rounded-xl font-semibold"
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        <div className="text-slate-600 text-xs">
          <p>Service: {bleService.state.toUpperCase()}</p>
        </div>

        {state === 'error' && (
          <div className="mt-8 text-left">
            <BLETest />
          </div>
        )}
      </motion.div>
    </div>
  );
}
