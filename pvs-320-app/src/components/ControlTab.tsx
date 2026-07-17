import React, { useState, useEffect, useRef } from 'react';
import { bleService } from '../services/bleService';
import { PALETTE_NAMES, PaletteIndex } from '../types';
import { Sliders, Maximize, Sun, Contrast, Zap, Save } from 'lucide-react';

type SliderGroupProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  icon: React.ComponentType<{ className?: string }>;
  onChange: (v: number) => void;
  onRelease: (v: number) => void;
};

// Hoisted to module scope so it keeps a stable identity across ControlTab
// re-renders (otherwise every BLE status push remounts it and interrupts
// typing/dragging).
function SliderGroup({ label, value, min, max, onChange, onRelease, icon: Icon }: SliderGroupProps) {
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  const id = `slider-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

  const commitDraft = () => {
    if (draftValue.trim() === '') {
      setDraftValue(String(value));
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
        <label htmlFor={id} className="flex items-center gap-2 text-slate-300">
          <Icon className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-semibold uppercase tracking-wider">{label}</span>
        </label>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label={`${label} value`}
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
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        onPointerUp={(e) => onRelease(parseInt(e.currentTarget.value, 10))}
        onKeyUp={(e) => onRelease(parseInt((e.currentTarget as HTMLInputElement).value, 10))}
        onBlur={(e) => onRelease(parseInt(e.currentTarget.value, 10))}
        className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
      />
    </div>
  );
}

// Backpressure-based sender: keeps only the LATEST value and sends it only when
// the previous send has actually completed — so there is never more than one
// write in flight and a queue can't build up on the shared BLE write chain
// (a wall-clock throttle would pile up sends whenever the link is slower than
// the interval). Auto-adapts to link speed and still guarantees the final value.
// `getMinGapMs` is an optional floor between sends (the per-device setting) so
// the user can go even gentler on a weak link; it never causes queueing.
function makeBackpressureSender(
  send: (v: number) => Promise<void>,
  getMinGapMs: () => number,
  onError?: (e: unknown) => void,
) {
  let inFlight = false;
  let pending: number | null = null;
  let lastSentAt = 0;
  let timer: number | null = null;

  const pump = () => {
    if (inFlight || pending === null) return;
    const wait = getMinGapMs() - (Date.now() - lastSentAt);
    if (wait > 0) {
      if (timer === null) timer = window.setTimeout(() => { timer = null; pump(); }, wait);
      return;
    }
    const v = pending;
    pending = null;
    inFlight = true;
    lastSentAt = Date.now();
    // Errors surface (deduped by the toast layer). finally -> pump keeps the
    // single-in-flight loop going and flushes the latest pending value.
    void send(v)
      .catch((e) => onError?.(e))
      .finally(() => { inFlight = false; pump(); });
  };

  return {
    // During a drag: remember the latest value; it goes out as soon as the link
    // is free (and no sooner than the min gap). Intermediate values are dropped.
    push(v: number) { pending = v; pump(); },
    // On release: guarantee the final value — bypass the min-gap wait, but still
    // respect the single in-flight write, so it lands right after the current one.
    flush(v: number) {
      pending = v;
      lastSentAt = 0;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      pump();
    },
    // On unmount: drop any pending value / timer so nothing fires late.
    cancel() {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      pending = null;
    },
  };
}

function reportError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  bleService.setLocalStatusMessage(message, 'error');
}

export default function ControlTab() {
  const [activeProfile, setActiveProfile] = useState(0);
  const [brightness, setBrightness] = useState(128);
  const [contrast, setContrast] = useState(4);
  const [enhancement, setEnhancement] = useState(4);
  const [zoom, setZoom] = useState(10);
  // '' = palette unknown (the P6 camera doesn't report its current palette, so
  // we don't guess "White Hot" — the selector stays empty until the user picks).
  const [palette, setPalette] = useState<PaletteIndex | ''>('');

  // Timestamp of the last slider interaction. Live-status sync is skipped for a
  // short grace window so a device echo can't clobber a value mid/just-after a
  // drag — and, being time-based, it self-recovers if a release event is missed.
  const lastInteractRef = useRef(0);

  // Per-device slider throttle (ms), read once when this tab mounts.
  const throttleRef = useRef<number | null>(null);
  if (throttleRef.current === null) {
    throttleRef.current = bleService.getDevicePref<number>(bleService.getConnectedDeviceKey(), 'sliderThrottleMs', 120);
  }
  const getThrottle = () => throttleRef.current ?? 120;

  // One backpressure sender per slider (stable across renders).
  const sendersRef = useRef({
    brightness: makeBackpressureSender((v) => bleService.setBrightness(v), getThrottle, reportError),
    contrast: makeBackpressureSender((v) => bleService.setContrast(v), getThrottle, reportError),
    enhancement: makeBackpressureSender((v) => bleService.setEnhancement(v), getThrottle, reportError),
    zoom: makeBackpressureSender((v) => bleService.setZoom(v), getThrottle, reportError),
  });

  useEffect(() => {
    const unsubscribe = bleService.onStatusUpdate((newStatus) => {
      if (newStatus.activeProfile !== undefined) setActiveProfile(newStatus.activeProfile);

      // Don't stomp on a slider the user just touched (500ms grace window).
      if (Date.now() - lastInteractRef.current > 500) {
        if (newStatus.brightness !== undefined) setBrightness(newStatus.brightness);
        if (newStatus.contrast !== undefined) setContrast(newStatus.contrast);
        if (newStatus.enhancement !== undefined) setEnhancement(newStatus.enhancement);
      }
      // palette intentionally NOT synced from status (unknown on P6 cameras).
    });
    const senders = sendersRef.current;
    return () => {
      unsubscribe();
      senders.brightness.cancel();
      senders.contrast.cancel();
      senders.enhancement.cancel();
      senders.zoom.cancel();
    };
  }, []);

  const fail = reportError;

  type SliderKey = 'brightness' | 'contrast' | 'enhancement' | 'zoom';

  // While dragging: update the thumb immediately + send a throttled live update.
  const onSlide = (key: SliderKey, setter: (v: number) => void) => (v: number) => {
    lastInteractRef.current = Date.now();
    setter(v);
    sendersRef.current[key].push(v);
  };

  // On release: guarantee the final value is sent, and keep the grace window open.
  const onSlideEnd = (key: SliderKey, setter: (v: number) => void) => (v: number) => {
    setter(v);
    sendersRef.current[key].flush(v);
    lastInteractRef.current = Date.now();
  };

  const handlePalette = (next: PaletteIndex) => {
    const prev = palette;
    setPalette(next);
    void bleService.setPalette(next).catch((error) => {
      setPalette(prev);
      fail(error);
    });
  };

  const handleProfileClick = (p: number) => {
    void (async () => {
      try {
        const profile = await bleService.getProfile(p);
        setActiveProfile(p);
        setBrightness(profile.brightness);
        setContrast(profile.contrast);
        setEnhancement(profile.enhancement);
        setPalette(profile.palette);
        await bleService.applyProfile(p);
      } catch (error) {
        fail(error);
      }
    })();
  };

  return (
    <div className="space-y-6 pb-24">
      {/* Save to Camera — persist current settings to the camera core */}
      <button
        onClick={() => { void bleService.saveToCamera().catch(fail); }}
        className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-white flex items-center justify-center gap-2 transition-colors shadow-lg shadow-blue-900/20"
      >
        <Save className="w-5 h-5" />
        Save to Camera
      </button>

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
            aria-label="Color palette"
            value={palette}
            onChange={(e) => handlePalette(parseInt(e.target.value, 10) as PaletteIndex)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-slate-300 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
          >
            <option value="" disabled>
              Select palette…
            </option>
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
          onChange={onSlide('brightness', setBrightness)}
          onRelease={onSlideEnd('brightness', setBrightness)}
        />

        <SliderGroup
          label="Contrast"
          value={contrast}
          min={0}
          max={7}
          icon={Contrast}
          onChange={onSlide('contrast', setContrast)}
          onRelease={onSlideEnd('contrast', setContrast)}
        />

        <SliderGroup
          label="Enhancement"
          value={enhancement}
          min={0}
          max={7}
          icon={Zap}
          onChange={onSlide('enhancement', setEnhancement)}
          onRelease={onSlideEnd('enhancement', setEnhancement)}
        />

        <SliderGroup
          label="Zoom (10-40 = 1.0x-4.0x)"
          value={zoom}
          min={10}
          max={40}
          icon={Maximize}
          onChange={onSlide('zoom', setZoom)}
          onRelease={onSlideEnd('zoom', setZoom)}
        />
      </div>
    </div>
  );
}
