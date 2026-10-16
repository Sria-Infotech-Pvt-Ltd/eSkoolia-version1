"use client";

import { useEffect, useState } from "react";
import { listStockRacks } from "@/hooks/useLibraryApi";
import { Field, inputStyle } from "../catalogue/ui";

/** "All racks" or one rack that has copies on the shelf. A failed load still leaves "All racks" usable. */
export function RackPicker({ value, onChange }: { value: string; onChange: (rack: string) => void }) {
  const [racks, setRacks] = useState<{ rack: string; copies: number }[]>([]);
  const [noRack, setNoRack] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listStockRacks({ silent401: true })
      .then((data) => {
        if (cancelled) return;
        setRacks(data.racks);
        setNoRack(data.no_rack);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const total = racks.reduce((sum, r) => sum + r.copies, 0) + noRack;
  return (
    <div style={{ minWidth: 240 }}>
      <Field label="Rack" hint={failed ? "The rack list could not be loaded. You can still check all racks." : noRack ? `${noRack} copies have no rack and are only included in "All racks".` : undefined}>
        <select style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">All racks ({total} copies)</option>
          {racks.map((r) => (
            <option key={r.rack} value={r.rack}>{r.rack} ({r.copies} copies)</option>
          ))}
        </select>
      </Field>
    </div>
  );
}
