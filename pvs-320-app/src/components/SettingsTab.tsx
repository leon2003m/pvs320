import React, { useState, useEffect } from 'react';
import { bleService } from '../services/bleService';
import { DeviceStatus } from '../types';
import { RefreshCw, Cpu, Info, Save, Wifi, Clock, Loader2 } from 'lucide-react';

export default function SettingsTab() {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [autoNuc, setAutoNuc] = useState(false);
  const [sliderThrottle, setSliderThrottle] = useState(120);
  const [otaPendingTarget, setOtaPendingTarget] = useState<boolean | null>(null);
  const [otaRemaining, setOtaRemaining] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const otaPendingTargetRef = React.useRef<boolean | null>(null);
  const bleNameTouchedRef = React.useRef(false);

  // Profile Editor State (palette is intentionally omitted: firmware ties a
  // profile's palette to its index, so it isn't independently storable.)
  const [editProfile, setEditProfile] = useState(0);
  const [editBrightness, setEditBrightness] = useState<number | "">(128);
  const [editContrast, setEditContrast] = useState<number | "">(4);
  const [editEnhancement, setEditEnhancement] = useState<number | "">(4);

  // Password / BLE name State
  const [newPassword, setNewPassword] = useState('');
  const [newBleName, setNewBleName] = useState('');

  // Seed the Auto-NUC toggle from the last value set for THIS camera (the
  // camera can't report its live auto-cal state, so this is a local memory).
  useEffect(() => {
    const key = bleService.getConnectedDeviceKey();
    setAutoNuc(bleService.getDevicePref<boolean>(key, 'autoNuc', false));
    setSliderThrottle(bleService.getDevicePref<number>(key, 'sliderThrottleMs', 120));
  }, []);

  useEffect(() => {
    otaPendingTargetRef.current = otaPendingTarget;
  }, [otaPendingTarget]);

  useEffect(() => {
    const unsubscribe = bleService.onStatusUpdate((newStatus) => {
      setStatus(newStatus);
      if (otaPendingTargetRef.current !== null && !!newStatus.otaActive === otaPendingTargetRef.current) {
        setOtaPendingTarget(null);
      }
      // NOTE: Profile Editor fields are NOT synced from live status — they
      // represent the profile being edited and are only loaded via getProfile.
      if (newStatus.bleName !== undefined && !bleNameTouchedRef.current) setNewBleName(newStatus.bleName);
    });
    return unsubscribe;
  }, []);

  // OTA countdown: reset from device value, then tick locally each second.
  useEffect(() => {
    setOtaRemaining(status?.otaRemainingMs ?? 0);
  }, [status?.otaRemainingMs, status?.otaActive]);

  useEffect(() => {
    if (!status?.otaActive) return;
    const id = window.setInterval(() => setOtaRemaining((r) => Math.max(0, r - 1000)), 1000);
    return () => window.clearInterval(id);
  }, [status?.otaActive]);

  useEffect(() => {
    if (otaPendingTarget === null) return;
    const timer = window.setTimeout(() => setOtaPendingTarget(null), 2500);
    return () => window.clearTimeout(timer);
  }, [otaPendingTarget]);

  const fail = (error: unknown) => {
    if (otaPendingTargetRef.current !== null) setOtaPendingTarget(null);
    const message = error instanceof Error ? error.message : String(error);
    bleService.setLocalStatusMessage(message, 'error');
  };

  const run = (promise: Promise<unknown>) => {
    void promise.catch(fail);
  };

  // Runs an action while showing a spinner / disabling its button.
  const runBusy = (name: string, promise: Promise<unknown>) => {
    setBusy(name);
    void promise.catch(fail).finally(() => setBusy(null));
  };

  const handleProfileSwitch = (p: number) => {
    setEditProfile(p);
    run((async () => {
      const profile = await bleService.getProfile(p);
      setEditBrightness(profile.brightness);
      setEditContrast(profile.contrast);
      setEditEnhancement(profile.enhancement);
    })());
  };

  const handleAutoNucToggle = () => {
    const next = !autoNuc;
    setAutoNuc(next);
    const key = bleService.getConnectedDeviceKey();
    void bleService.setAutoCalibration(next)
      .then(() => bleService.setDevicePref(key, 'autoNuc', next))
      .catch((error) => {
        setAutoNuc(!next); // roll back the toggle
        fail(error);
      });
  };

  const handleThrottleChange = (ms: number) => {
    setSliderThrottle(ms);
    bleService.setDevicePref(bleService.getConnectedDeviceKey(), 'sliderThrottleMs', ms);
  };

  const handleSaveProfile = () => {
    if (editBrightness === "" || editContrast === "" || editEnhancement === "") return;
    runBusy('save-profile', bleService.saveProfile(editProfile, editBrightness, editContrast, editEnhancement));
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

  const calButtonClass = "py-4 bg-slate-900 border border-slate-800 rounded-xl font-semibold text-slate-300 hover:bg-slate-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2";

  return (
    <div className="space-y-8 pb-24">
      {/* Calibration */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Calibration</h3>
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600/20 rounded-lg">
              <RefreshCw className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="font-semibold text-slate-200">Auto NUCing Toggle</p>
              <p className="text-xs text-slate-500">Automatic Non-Uniformity Correction (shows last set from this app)</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoNuc ? 'true' : 'false'}
            aria-label="Toggle automatic NUC"
            onClick={handleAutoNucToggle}
            className={`w-14 h-8 rounded-full transition-colors relative ${autoNuc ? 'bg-blue-600' : 'bg-slate-700'}`}
          >
            <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${autoNuc ? 'left-7' : 'left-1'}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => runBusy('screen', bleService.runScreenAdjust())}
            disabled={busy !== null}
            className={calButtonClass}
          >
            {busy === 'screen' && <Loader2 className="w-4 h-4 animate-spin" />}
            Screen Adjust
          </button>
          <button
            onClick={() => runBusy('manual', bleService.runManualCalibration())}
            disabled={busy !== null}
            className={calButtonClass}
          >
            {busy === 'manual' && <Loader2 className="w-4 h-4 animate-spin" />}
            Manual Adjust
          </button>
          <button
            onClick={() => runBusy('dpc', bleService.runDpc())}
            disabled={busy !== null}
            className={`${calButtonClass} col-span-2`}
          >
            {busy === 'dpc' && <Loader2 className="w-4 h-4 animate-spin" />}
            Dead Pixel Correction
          </button>
        </div>
        <p className="text-[11px] text-slate-500 ml-1">
          Dead Pixel Correction runs a ~3s calibration and permanently saves it to the camera core.
        </p>
      </section>

      {/* Slider Response */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Slider Response</h3>
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-slate-200">Live update rate</p>
              <p className="text-xs text-slate-500">Minimum gap between slider commands. Sends already wait for the previous one to finish (no queue); raise this to go even gentler on a weak link.</p>
            </div>
            <select
              value={sliderThrottle}
              onChange={(e) => handleThrottleChange(parseInt(e.target.value, 10))}
              aria-label="Slider live update rate"
              className="flex-shrink-0 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value={60}>Fastest (60ms)</option>
              <option value={90}>Fast (90ms)</option>
              <option value={120}>Balanced (120ms)</option>
              <option value={200}>Relaxed (200ms)</option>
              <option value={300}>Weak link (300ms)</option>
            </select>
          </div>
          <p className="text-[11px] text-slate-500">Saved per camera. The final value is always sent on release.</p>
        </div>
      </section>

      {/* Security Section */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Security &amp; Device</h3>
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 space-y-6">
          <div className="space-y-2">
            <label htmlFor="change-password" className="text-xs font-bold text-slate-500 uppercase">Change Device Password</label>
            <div className="flex gap-2 items-center">
              <input
                id="change-password"
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
            <label htmlFor="change-ble-name" className="text-xs font-bold text-slate-500 uppercase">Change BLE Name</label>
            <div className="flex gap-2 items-center">
              <input
                id="change-ble-name"
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
            <p className="text-[11px] text-slate-500">1-20 characters. Device will update advertising immediately.</p>
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
                  {Math.ceil(otaRemaining / 1000)}s
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
            <span className="text-xs font-bold text-slate-500 uppercase">Select Profile</span>
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
            <p className="text-[11px] text-slate-500">Each profile applies its matching palette (P{editProfile} → palette {editProfile}).</p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <label htmlFor="edit-brightness" className="text-[11px] font-bold text-slate-500 uppercase">Brightness (0-255)</label>
              <input
                id="edit-brightness"
                type="number"
                value={editBrightness}
                onChange={(e) => handleNumericInput(e.target.value, 255, setEditBrightness)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="edit-contrast" className="text-[11px] font-bold text-slate-500 uppercase">Contrast (0-7)</label>
              <input
                id="edit-contrast"
                type="number"
                value={editContrast}
                onChange={(e) => handleNumericInput(e.target.value, 7, setEditContrast)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="edit-enhancement" className="text-[11px] font-bold text-slate-500 uppercase">Enhancement (0-7)</label>
              <input
                id="edit-enhancement"
                type="number"
                value={editEnhancement}
                onChange={(e) => handleNumericInput(e.target.value, 7, setEditEnhancement)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <button
            onClick={handleSaveProfile}
            disabled={busy === 'save-profile'}
            className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-white flex items-center justify-center gap-2 transition-colors shadow-lg shadow-blue-900/20 disabled:opacity-50"
          >
            {busy === 'save-profile' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
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
