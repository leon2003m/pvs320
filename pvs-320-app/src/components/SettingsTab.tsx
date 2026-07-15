import React, { useState, useEffect } from 'react';
import { bleService } from '../services/bleService';
import { DeviceStatus, PALETTE_NAMES, PaletteIndex } from '../types';
import { Settings, RefreshCw, Cpu, Info, Save, Wifi, Clock } from 'lucide-react';

export default function SettingsTab() {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [autoNuc, setAutoNuc] = useState(false);
  const [otaPendingTarget, setOtaPendingTarget] = useState<boolean | null>(null);
  const otaPendingTargetRef = React.useRef<boolean | null>(null);
  const bleNameTouchedRef = React.useRef(false);
  
  // Profile Editor State
  const [editProfile, setEditProfile] = useState(0);
  const [editBrightness, setEditBrightness] = useState<number | "">(128);
  const [editContrast, setEditContrast] = useState<number | "">(4);
  const [editEnhancement, setEditEnhancement] = useState<number | "">(4);
  const [editPalette, setEditPalette] = useState<PaletteIndex>(0);

  // Password Change State
  const [newPassword, setNewPassword] = useState('');
  const [newBleName, setNewBleName] = useState('');

  useEffect(() => {
    otaPendingTargetRef.current = otaPendingTarget;
  }, [otaPendingTarget]);

  useEffect(() => {
    const unsubscribe = bleService.onStatusUpdate((newStatus) => {
      setStatus(newStatus);
      if (otaPendingTargetRef.current !== null && !!newStatus.otaActive === otaPendingTargetRef.current) {
        setOtaPendingTarget(null);
      }
      
      // Sync local state with device status if fields are present
      if (newStatus.brightness !== undefined) setEditBrightness(newStatus.brightness);
      if (newStatus.contrast !== undefined) setEditContrast(newStatus.contrast);
      if (newStatus.enhancement !== undefined) setEditEnhancement(newStatus.enhancement);
      if (newStatus.palette !== undefined) setEditPalette(newStatus.palette);
      if (newStatus.bleName !== undefined && !bleNameTouchedRef.current) setNewBleName(newStatus.bleName);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (otaPendingTarget === null) return;

    const timer = window.setTimeout(() => {
      setOtaPendingTarget(null);
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [otaPendingTarget]);

  const run = (promise: Promise<unknown>) => {
    void promise.catch((error) => {
      if (otaPendingTarget !== null) {
        setOtaPendingTarget(null);
      }
      const message = error instanceof Error ? error.message : String(error);
      bleService.setLocalStatusMessage(message, 'error');
    });
  };

  const handleProfileSwitch = async (p: number) => {
    setEditProfile(p);
    run((async () => {
      const profile = await bleService.getProfile(p);
      setEditBrightness(profile.brightness);
      setEditContrast(profile.contrast);
      setEditEnhancement(profile.enhancement);
      setEditPalette(profile.palette);
    })());
  };

  const handleAutoNucToggle = () => {
    const newState = !autoNuc;
    setAutoNuc(newState);
    run(bleService.setAutoCalibration(newState));
  };

  const handleSaveProfile = () => {
    if (editBrightness === "" || editContrast === "" || editEnhancement === "") return;
    run(bleService.saveProfile(editProfile, editBrightness, editContrast, editEnhancement));
  };

  const handleChangePassword = () => {
    if (!newPassword) return;
    run(bleService.setPassword(newPassword));
    setNewPassword('');
  };

  const handleChangeBleName = () => {
    if (!newBleName) return;
    run(bleService.setBleName(newBleName));
  };

  const handleNumericInput = (val: string, max: number, setter: (v: number | "") => void) => {
    if (val === "") {
      setter("");
      return;
    }
    const num = parseInt(val);
    if (!isNaN(num)) {
      setter(Math.min(max, Math.max(0, num)));
    }
  };

  const handleOtaToggle = () => {
    const nextState = !(otaPendingTarget ?? status?.otaActive ?? false);
    setOtaPendingTarget(nextState);

    if (status?.otaActive) {
      run(bleService.stopOta());
      return;
    }

    run(bleService.startOta());
  };

  const otaEnabled = otaPendingTarget ?? status?.otaActive ?? false;

  return (
    <div className="space-y-8 pb-24">
      {/* Auto NUCing */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Calibration</h3>
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600/20 rounded-lg">
              <RefreshCw className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="font-semibold text-slate-200">Auto NUCing Toggle</p>
              <p className="text-xs text-slate-500">Automatic Non-Uniformity Correction</p>
            </div>
          </div>
          <button 
            onClick={handleAutoNucToggle}
            className={`w-14 h-8 rounded-full transition-colors relative ${autoNuc ? 'bg-blue-600' : 'bg-slate-700'}`}
          >
            <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${autoNuc ? 'left-7' : 'left-1'}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => run(bleService.runScreenAdjust())}
            className="py-4 bg-slate-900 border border-slate-800 rounded-xl font-semibold text-slate-300 hover:bg-slate-800 transition-all"
          >
            Sceen Adjust
          </button>
          <button
            onClick={() => run(bleService.runManualCalibration())}
            className="py-4 bg-slate-900 border border-slate-800 rounded-xl font-semibold text-slate-300 hover:bg-slate-800 transition-all"
          >
            Manual Adjust
          </button>
          <button
            onClick={() => run(bleService.runDpc())}
            className="py-4 bg-slate-900 border border-slate-800 rounded-xl font-semibold text-slate-300 hover:bg-slate-800 transition-all"
          >
            Dead Pixel Correction
          </button>
          <button
            onClick={() => run(bleService.saveToCamera())}
            className="py-4 bg-slate-900 border border-slate-800 rounded-xl font-semibold text-slate-300 hover:bg-slate-800 transition-all"
          >
            Save to Camera
          </button>
        </div>
        <p className="text-[10px] text-slate-500 ml-1">
          Dead Pixel Correction runs a ~3s calibration and permanently saves it to the camera core.
        </p>
      </section>

      {/* Security Section */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Security & Device</h3>
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase">Change Device Password</label>
            <div className="flex gap-2 items-center">
              <input 
                type="password" 
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-blue-500"
              />
              <button 
                onClick={handleChangePassword}
                className="flex-shrink-0 px-4 py-2 bg-slate-800 hover:bg-blue-600 border border-slate-700 rounded-lg font-bold text-slate-200 transition-all"
              >
                Set
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase">Change BLE Name</label>
            <div className="flex gap-2 items-center">
              <input 
                type="text" 
                value={newBleName}
                onChange={(e) => {
                  bleNameTouchedRef.current = true;
                  setNewBleName(e.target.value);
                }}
                placeholder="New BLE Name"
                maxLength={20}
                className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-blue-500"
              />
              <button 
                onClick={handleChangeBleName}
                className="flex-shrink-0 px-4 py-2 bg-slate-800 hover:bg-blue-600 border border-slate-700 rounded-lg font-bold text-slate-200 transition-all"
              >
                Set
              </button>
            </div>
            <p className="text-[10px] text-slate-500">1-20 characters. Device will update advertising immediately.</p>
          </div>
        </div>
      </section>

      {/* OTA Section */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Firmware Update</h3>
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <RefreshCw className={`w-5 h-5 ${otaEnabled ? 'text-blue-400 animate-spin' : 'text-slate-400'}`} />
                <span className="font-bold text-slate-200">OTA Update</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {otaEnabled ? 'OTA Wi-Fi is enabled and ready for upload.' : 'Enable the OTA Wi-Fi access point for wireless updates.'}
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={otaEnabled ? 'true' : 'false'}
              aria-label="Toggle OTA update mode"
              onClick={handleOtaToggle}
              className={`relative h-8 w-14 rounded-full transition-colors ${otaEnabled ? 'bg-blue-600' : 'bg-slate-700'}`}
            >
              <span
                className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${otaEnabled ? 'left-7' : 'left-1'}`}
              />
            </button>
          </div>

          {otaEnabled && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-blue-400">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span className="font-bold">OTA Active</span>
                </div>
                <div className="flex items-center gap-1 text-slate-400 font-mono text-sm">
                  <Clock className="w-4 h-4" />
                  {Math.ceil(status.otaRemainingMs / 1000)}s
                </div>
              </div>

              <div className="bg-slate-950 rounded-xl p-4 space-y-2 border border-slate-800">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">SSID</span>
                  <span className="text-slate-300 font-mono">ThermalCameraOTA</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Password</span>
                  <span className="text-slate-300 font-mono">changeme</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">IP Address</span>
                  <span className="text-slate-300 font-mono">192.168.8.1</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Profile Editor */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Profile Editor</h3>
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase">Select Profile</label>
            <div className="grid grid-cols-5 gap-2">
              {[0, 1, 2, 3, 4].map(p => (
                <button
                  key={p}
                  onClick={() => handleProfileSwitch(p)}
                  className={`py-2 rounded-lg font-bold transition-all ${editProfile === p ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Brightness (0-255)</label>
              <input 
                type="number" 
                value={editBrightness}
                onChange={(e) => handleNumericInput(e.target.value, 255, setEditBrightness)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Contrast (0-7)</label>
              <input 
                type="number" 
                value={editContrast}
                onChange={(e) => handleNumericInput(e.target.value, 7, setEditContrast)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Enhance (0-7)</label>
              <input 
                type="number" 
                value={editEnhancement}
                onChange={(e) => handleNumericInput(e.target.value, 7, setEditEnhancement)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Palette (0-4)</label>
              <select 
                value={editPalette}
                onChange={(e) => setEditPalette(parseInt(e.target.value) as PaletteIndex)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-blue-500"
              >
                {Object.entries(PALETTE_NAMES).map(([idx, name]) => (
                  <option key={idx} value={idx}>{name}</option>
                ))}
              </select>
            </div>
          </div>

          <button 
            onClick={handleSaveProfile}
            className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-white flex items-center justify-center gap-2 transition-colors shadow-lg shadow-blue-900/20"
          >
            <Save className="w-5 h-5" />
            Save Profile {editProfile}
          </button>
        </div>
      </section>

      {/* Device Info */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Device Information</h3>
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="space-y-3">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-slate-400">
                <Cpu className="w-4 h-4" />
                <span className="text-sm">Model</span>
              </div>
              <span className={`font-mono font-bold ${(!status?.model || status.model === 'not connected') ? 'text-red-400' : 'text-slate-200'}`}>
                {status?.model || 'Not Connected'}
              </span>
            </div>
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-slate-400">
                <Info className="w-4 h-4" />
                <span className="text-sm">Firmware</span>
              </div>
              <span className={`font-mono font-bold ${(!status?.firmware || status.firmware === 'not connected') ? 'text-red-400' : 'text-slate-200'}`}>
                {status?.firmware || 'Not Connected'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-slate-400">
                <Wifi className="w-4 h-4" />
                <span className="text-sm">BLE Name</span>
              </div>
              <span className="text-slate-200 font-mono font-bold">{status?.bleName || 'ThermalCamera'}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
