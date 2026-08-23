import { useEffect, useRef } from 'react';
import { SimpleSheet } from './SimpleSheet';
import { useBottomSheetStore, type SheetKind } from '../../store/bottomSheetStore';
import { PredictionSettingsSheet } from '../../screens/sheets/PredictionSettingsSheet';
import { MarkRecoveredSheet } from '../../screens/sheets/MarkRecoveredSheet';
import { StartRoutingSheet } from '../../screens/sheets/StartRoutingSheet';
import { DoaBearingSheet } from '../../screens/sheets/DoaBearingSheet';

/**
 * Single root-level host for every bottom sheet (M7 prediction settings, M8 mark
 * recovered, M11 DOA bearing, M12 start routing) — driven declaratively by
 * bottomSheetStore rather than each screen owning its own modal instance, since
 * sheets are opened from multiple places (APRS list row, callsign detail, Track map).
 */
export function BottomSheetHost() {
  const sheet = useBottomSheetStore((s) => s.sheet);
  const callsign = useBottomSheetStore((s) => s.callsign);
  const close = useBottomSheetStore((s) => s.close);

  // The store clears `sheet`/`callsign` to null the instant close() fires, but the
  // sheet itself keeps animating shut for another ~180ms — render the last real
  // sheet content during that window instead of unmounting it out from under the
  // still-visible, still-sliding-away sheet.
  const lastRef = useRef<{ sheet: SheetKind; callsign: string | null }>({ sheet, callsign });
  if (sheet) lastRef.current = { sheet, callsign };
  const rendered = sheet ? { sheet, callsign } : lastRef.current;

  return (
    <SimpleSheet visible={sheet !== null} onClose={close}>
      {rendered.sheet === 'predictionSettings' && rendered.callsign && (
        <PredictionSettingsSheet callsign={rendered.callsign} onDone={close} />
      )}
      {rendered.sheet === 'markRecovered' && rendered.callsign && (
        <MarkRecoveredSheet callsign={rendered.callsign} onDone={close} />
      )}
      {rendered.sheet === 'startRouting' && rendered.callsign && (
        <StartRoutingSheet targetCallsign={rendered.callsign} onDone={close} />
      )}
      {rendered.sheet === 'doaBearing' && <DoaBearingSheet />}
    </SimpleSheet>
  );
}
