import React, { useState, useEffect } from 'react';
import { Bluetooth, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

export default function BLETest() {
  const [support, setSupport] = useState<{
    available: boolean;
    reason?: string;
  }>({ available: false });

  useEffect(() => {
    const checkBluetooth = async () => {
      const nav = navigator as any;
      if (!nav.bluetooth) {
        setSupport({ 
          available: false, 
          reason: "Web Bluetooth API is not supported by this browser or is disabled." 
        });
        return;
      }

      try {
        const isAvailable = await nav.bluetooth.getAvailability();
        setSupport({ 
          available: isAvailable, 
          reason: isAvailable ? "Bluetooth hardware is available and accessible." : "Bluetooth hardware is not available on this device." 
        });
      } catch (err) {
        setSupport({ 
          available: false, 
          reason: "Access to Bluetooth is restricted (likely due to iframe sandboxing or missing permissions)." 
        });
      }
    };

    checkBluetooth();
  }, []);

  return (
    <div className="p-6 bg-slate-900 rounded-2xl border border-slate-800 space-y-4">
      <div className="flex items-center gap-3">
        <Bluetooth className={`w-6 h-6 ${support.available ? 'text-green-500' : 'text-amber-500'}`} />
        <h2 className="text-lg font-bold text-white">Bluetooth Support Check</h2>
      </div>

      <div className="space-y-3">
        <div className="flex items-start gap-3 p-3 bg-slate-950 rounded-xl border border-slate-800">
          {support.available ? (
            <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
          ) : (
            <XCircle className="w-5 h-5 text-red-500 mt-0.5" />
          )}
          <div>
            <p className="font-semibold text-slate-200">
              {support.available ? 'Web Bluetooth Supported' : 'Web Bluetooth Restricted'}
            </p>
            <p className="text-sm text-slate-500 mt-1">{support.reason}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
