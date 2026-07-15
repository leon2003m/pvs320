import React, { useState, useEffect } from 'react';
import { bleService } from '../services/bleService';
import { DeviceStatus, PALETTE_NAMES, PaletteIndex } from '../types';
import { Sliders, Maximize, Sun, Contrast, Zap } from 'lucide-react';

export default function ControlTab() {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [activeProfile, setActiveProfile] = useState(0);
  const [brightness, setBrightness] = useState(128);
  const [contrast, setContrast] = useState(4);
  const [enhancement, setEnhancement] = useState(4);
  const [zoom, setZoom] = useState(10);
  const [palette, setPalette] = useState<PaletteIndex>(0);

  useEffect(() => {
    const unsubscribe = bleService.onStatusUpdate((newStatus) => {
      setStatus(newStatus);
      
      // Sync local state with device status if fields are present
      if (newStatus.activeProfile !== undefined) setActiveProfile(newStatus.activeProfile);
      if (newStatus.brightness !== undefined) setBrightness(newStatus.brightness);
      if (newStatus.contrast !== undefined) setContrast(newStatus.contrast);
      if (newStatus.enhancement !== undefined) setEnhancement(newStatus.enhancement);
      if (newStatus.palette !== undefined) setPalette(newStatus.palette);
    });
    return unsubscribe;
  }, []);

  const run = (promise: Promise<unknown>) => {
    void promise.catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      bleService.setLocalStatusMessage(message, 'error');
    });
  };

  const handleProfileClick = (p: number) => {
    run((async () => {
      const profile = await bleService.getProfile(p);
      setActiveProfile(p);
      setBrightness(profile.brightness);
      setContrast(profile.contrast);
      setEnhancement(profile.enhancement);
      setPalette(profile.palette);
      await bleService.applyProfile(p);
    })());
  };

  const SliderGroup = ({ 
    label, 
    value, 
    min, 
    max, 
    onChange, 
    onRelease, 
    icon: Icon 
  }: any) => {
    const [draftValue, setDraftValue] = useState(String(value));

    useEffect(() => {
      setDraftValue(String(value));
    }, [value]);

    const commitDraft = () => {
      if (draftValue.trim() === '') {
        return;
      }

      const parsed = Number.parseInt(draftValue, 10);
      if (Number.isNaN(parsed)) {
        setDraftValue(String(value));
        return;
      }

      const clamped = Math.min(max, Math.max(min, parsed));
      setDraftValue(String(clamped));
      onChange(clamped);
      onRelease(clamped);
    };

    return (
      <div className="space-y-3 bg-slate-900/50 p-4 rounded-2xl border border-slate-800">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2 text-slate-300">
            <Icon className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-semibold uppercase tracking-wider">{label}</span>
          </div>
          <input 
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitDraft();
              }
            }}
            className="w-16 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-blue-400 font-mono font-bold text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          onPointerUp={(e) => onRelease(parseInt(e.currentTarget.value, 10))}
          onKeyUp={(e) => onRelease(parseInt((e.currentTarget as HTMLInputElement).value, 10))}
          onBlur={(e) => onRelease(parseInt(e.currentTarget.value, 10))}
          className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
        />
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-24">
      {/* Profiles */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Quick Profiles</h3>
        <div className="grid grid-cols-5 gap-2">
          {[0, 1, 2, 3, 4].map((p) => (
            <button
              key={p}
              onClick={() => handleProfileClick(p)}
              className={`py-3 border rounded-xl font-bold transition-all active:scale-95 ${
                activeProfile === p
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-blue-600 hover:text-white hover:border-blue-500'
              }`}
            >
              P{p}
            </button>
          ))}
        </div>
      </div>

      {/* Palette */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Color Palette</h3>
        <div className="relative">
          <select
            value={palette}
            onChange={(e) => {
              const nextPalette = parseInt(e.target.value, 10) as PaletteIndex;
              setPalette(nextPalette);
              run(bleService.setPalette(nextPalette));
            }}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-slate-300 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
          >
            {(Object.entries(PALETTE_NAMES) as [string, string][]).map(([idx, name]) => (
              <option key={idx} value={idx} className="bg-slate-900 text-slate-300">
                {name} (ID: {idx})
              </option>
            ))}
          </select>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
            <Sliders className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Sliders */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Image Controls</h3>
        
        <SliderGroup
          label="Brightness"
          value={brightness}
          min={0}
          max={255}
          icon={Sun}
          onChange={setBrightness}
          onRelease={(v: number) => run(bleService.setBrightness(v))}
        />

        <SliderGroup
          label="Contrast"
          value={contrast}
          min={0}
          max={7}
          icon={Contrast}
          onChange={setContrast}
          onRelease={(v: number) => run(bleService.setContrast(v))}
        />

        <SliderGroup
          label="Enhancement"
          value={enhancement}
          min={0}
          max={7}
          icon={Zap}
          onChange={setEnhancement}
          onRelease={(v: number) => run(bleService.setEnhancement(v))}
        />

        <SliderGroup
          label="Zoom (10-40 = 1.0x-4.0x)"
          value={zoom}
          min={10}
          max={40}
          icon={Maximize}
          onChange={setZoom}
          onRelease={(v: number) => run(bleService.setZoom(v))}
        />
      </div>
    </div>
  );
}
