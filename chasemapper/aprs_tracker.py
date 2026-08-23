#!/usr/bin/env python3
"""APRS position tracking with APRS-IS streaming and aprs.fi fallback.

The tracker prefers native APRS-IS streaming through :mod:`aprslib` and falls
back to aprs.fi polling if the stream client is unavailable or the APRS-IS
connection cannot be established. Position updates are delivered to a callback
as typed APRS packets containing latitude, longitude, altitude, callsign, and
optionally a parsed timestamp.

The tracker is thread-safe for runtime callsign updates. Callsign mutations are
protected with an :class:`threading.RLock`, and any active APRS-IS filter is
refreshed when the callsign list changes.
"""

from __future__ import annotations

import logging
import json
import time
import math
from datetime import datetime, timezone
from threading import RLock, Thread
from typing import Any, Callable, Iterable, Mapping, TypedDict
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


logger = logging.getLogger(__name__)


class APRSPacket(TypedDict, total=False):
    """Callback payload for a tracked APRS position update."""

    lat: float
    lon: float
    alt: float
    callsign: str
    time_dt: datetime


class APRSTracker(Thread):
    """Background APRS tracker.

    The tracker prefers APRS-IS streaming via :mod:`aprslib` and falls back to
    aprs.fi polling when streaming is unavailable. Packet callbacks receive an
    :class:`APRSPacket` mapping. Duplicate suppression is timestamp-based: when
    a packet includes a timestamp for a callsign, packets with an older or equal
    timestamp are ignored.

    Callsign mutation methods are safe to call while the tracker is running.
    Updates are protected by an :class:`RLock`, and the active APRS-IS filter is
    refreshed when the callsign set changes.
    """

    def __init__(
        self,
        callsigns: Iterable[str],
        poll_interval: int | float,
        callback: Callable[[APRSPacket], None],
        api_key: str | None = None,
    ) -> None:
        """Initialise a tracker instance.

        Args:
            callsigns: Callsigns to track.
            poll_interval: Minimum number of seconds between aprs.fi polling
                cycles.
            callback: Function invoked for each accepted packet.
            api_key: Optional aprs.fi API key. Use ``None`` or ``"none"`` to
                disable authenticated polling.
        """

        super().__init__(daemon=True)
        self.callsigns: list[str] = self._normalize_callsigns(callsigns)
        self.poll_interval = max(5, int(poll_interval))
        self.callback = callback
        self.api_key = api_key if api_key and api_key.lower() != "none" else None
        self._running = False
        self._last_time: dict[str, datetime] = {}
        self._lock = RLock()
        self._aprsis: Any | None = None

    def run(self) -> None:
        """Start tracking, preferring APRS-IS and falling back to polling."""

        logger.info("APRS tracker started for: %s", ", ".join(self._snapshot_callsigns()) or "<none>")
        self._running = True

        try:
            _streamed = self._run_aprsis()
        except Exception:
            logger.exception("APRS-IS streaming failed unexpectedly; falling back to aprs.fi polling.")
            _streamed = False

        if not _streamed and self._running:
            try:
                self._run_polling()
            except Exception:
                logger.exception("APRS polling failed unexpectedly; APRS tracking has stopped.")

    def stop(self) -> None:
        """Request that the tracker stop and close any active APRS-IS stream."""

        logger.info("Stopping APRS tracker")
        self._running = False

        ais = self._snapshot_aprsis()
        if ais is None:
            return

        try:
            ais.close()
        except Exception:
            logger.exception("Error while closing APRS-IS connection")

    def _run_aprsis(self) -> bool:
        """Run the APRS-IS streaming path using :mod:`aprslib`.

        Returns:
            ``True`` when the stream ran until the tracker was stopped,
            ``False`` when streaming was unavailable or failed and the caller
            should fall back to aprs.fi polling.
        """

        try:
            import aprslib
        except Exception as exc:
            logger.info("aprslib unavailable, falling back to aprs.fi polling: %s", exc)
            return False

        callsigns = self._snapshot_callsigns()
        if not callsigns:
            logger.info("No callsigns configured for APRS-IS streaming")
            return False

        filter_text = self._build_aprsis_filter(callsigns)
        ais = aprslib.IS("NOCALL", "-1", host="rotate.aprs.net", port=14580)
        ais.set_filter(filter_text)

        with self._lock:
            self._aprsis = ais

        logger.info("Connecting to APRS-IS with filter: %s", filter_text or "<none>")

        try:
            ais.connect()

            def handle_line(raw_line: Any) -> None:
                if not self._running:
                    raise StopIteration

                line = self._line_to_text(raw_line)
                if not self._should_parse_line(line):
                    return

                try:
                    packet = aprslib.parse(line)
                except Exception as exc:
                    if "invalid packet header" in str(exc).lower():
                        logger.debug("APRS-IS ignored non-packet line: %s", line)
                    else:
                        logger.warning("APRS-IS parse error: %s", exc)
                    return

                parsed_packet = self._packet_from_aprsis(packet)
                if parsed_packet is None:
                    return

                callsign = parsed_packet.get("callsign")
                if not callsign:
                    return
                assert callsign is not None

                if self._is_duplicate(callsign, parsed_packet.get("time_dt")):
                    return

                self._emit_packet(parsed_packet, "APRS-IS")

            ais.consumer(callback=handle_line, blocking=True, raw=True)
            return True
        except StopIteration:
            return True
        except Exception as exc:
            if self._running:
                logger.warning("APRS-IS stream failed, falling back to aprs.fi polling: %s", exc)
            return False
        finally:
            with self._lock:
                if self._aprsis is ais:
                    self._aprsis = None

            try:
                ais.close()
            except Exception:
                pass

    def _run_polling(self) -> None:
        """Run the aprs.fi polling fallback loop."""

        logger.info("Starting aprs.fi polling loop")

        while self._running:
            callsigns = self._snapshot_callsigns()
            if not callsigns:
                logger.debug("No callsigns configured, sleeping for %s seconds", self.poll_interval)
                self._sleep_with_stop(self.poll_interval)
                continue

            for callsign in callsigns:
                if not self._running:
                    break

                self._poll_callsign(callsign)
                self._sleep_with_stop(0.5)

            self._sleep_with_stop(self.poll_interval)

        logger.info("APRS polling stopped")

    def _poll_callsign(self, callsign: str) -> None:
        """Poll aprs.fi for one callsign and dispatch the newest valid packet."""

        try:
            logger.info("APRS polling request for %s", callsign)

            params: dict[str, Any] = {
                "name": callsign,
                "what": "loc",
                "format": "json",
            }
            if self.api_key:
                params["apikey"] = self.api_key

            request = Request(
                f"https://api.aprs.fi/api/get?{urlencode(params)}",
                headers={"User-Agent": "chasemapper/1.0"},
            )
            with urlopen(request, timeout=10) as response:
                status_code = getattr(response, "status", 200)
                body = response.read().decode("utf-8", errors="replace")

            logger.info("APRS polling response for %s: HTTP %s", callsign, status_code)
            if status_code != 200:
                logger.warning("APRS non-200 response for %s: %s", callsign, status_code)
                return

            try:
                payload = json.loads(body)
            except Exception as exc:
                logger.warning(
                    "APRS polling non-JSON response for %s: %s body=%s",
                    callsign,
                    exc,
                    body[:180],
                )
                return

            entries: list[dict[str, Any]] = []
            if isinstance(payload, dict):
                entries_value = payload.get("entries", [])
                if isinstance(entries_value, list):
                    entries = entries_value

                if not entries:
                    result_value = payload.get("result")
                    if isinstance(result_value, list):
                        entries = result_value
                    elif isinstance(result_value, str) and result_value.lower() != "ok":
                        description = payload.get("description") or payload.get("error") or "no description"
                        logger.warning(
                            "APRS polling not OK for %s: result=%s description=%s",
                            callsign,
                            result_value,
                            description,
                        )
            elif isinstance(payload, list):
                entries = payload
            else:
                logger.warning(
                    "APRS polling unexpected payload for %s: type=%s body=%s",
                    callsign,
                    type(payload).__name__,
                    str(payload)[:180],
                )
                return

            if not entries:
                logger.warning("APRS: no entries for %s", callsign)
                return

            entry = entries[0]
            parsed_packet = self._packet_from_polling(callsign, entry)
            if parsed_packet is None:
                return

            callsign = parsed_packet.get("callsign")
            if not callsign:
                return
            assert callsign is not None

            if self._is_duplicate(callsign, parsed_packet.get("time_dt")):
                return

            self._emit_packet(parsed_packet, "APRS")
        except (OSError, URLError, TimeoutError, ValueError) as exc:
            logger.warning("APRS polling error for %s: %s", callsign, exc)

    def add_callsign(self, callsign: str) -> None:
        """Add a callsign at runtime and refresh the APRS-IS filter if active."""

        normalized = self._normalize_callsign(callsign)
        if not normalized:
            return

        changed = False
        with self._lock:
            if normalized not in self.callsigns:
                self.callsigns.append(normalized)
                changed = True

        if changed:
            logger.info("APRS added callsign: %s", normalized)
            self._refresh_aprsis_filter()

    def remove_callsign(self, callsign: str) -> None:
        """Remove a callsign at runtime and refresh the APRS-IS filter if active."""

        normalized = self._normalize_callsign(callsign)
        if not normalized:
            return

        changed = False
        with self._lock:
            try:
                self.callsigns.remove(normalized)
                changed = True
            except ValueError:
                return

        if changed:
            logger.info("APRS removed callsign: %s", normalized)
            self._refresh_aprsis_filter()

    def set_callsigns(self, callsigns: Iterable[str]) -> None:
        """Replace the tracked callsigns at runtime.

        The update is applied atomically under the tracker lock, and any active
        APRS-IS session receives the updated filter.
        """

        normalized_callsigns = self._normalize_callsigns(callsigns)
        with self._lock:
            self.callsigns = normalized_callsigns

        logger.info("APRS set callsigns: %s", ", ".join(normalized_callsigns) or "<none>")
        self._refresh_aprsis_filter()

    def _normalize_callsigns(self, callsigns: Iterable[str]) -> list[str]:
        """Return a deduplicated, normalized callsign list."""

        normalized_callsigns: list[str] = []
        for callsign in callsigns:
            normalized = self._normalize_callsign(callsign)
            if normalized and normalized not in normalized_callsigns:
                normalized_callsigns.append(normalized)
        return normalized_callsigns

    @staticmethod
    def _normalize_callsign(callsign: str) -> str:
        """Return a canonical callsign string."""

        return callsign.strip().upper()

    def _snapshot_callsigns(self) -> list[str]:
        """Return a thread-safe copy of the current callsign list."""

        with self._lock:
            return list(self.callsigns)

    def _snapshot_aprsis(self) -> Any | None:
        """Return the active APRS-IS connection, if any."""

        with self._lock:
            return self._aprsis

    def _refresh_aprsis_filter(self) -> None:
        """Push the current callsign filter to the active APRS-IS session."""

        ais = self._snapshot_aprsis()
        if ais is None:
            return

        filter_text = self._build_aprsis_filter(self._snapshot_callsigns())
        try:
            ais.set_filter(filter_text)
            logger.info("APRS-IS filter updated: %s", filter_text or "<none>")
        except Exception:
            logger.exception("Failed to update APRS-IS filter")

    @staticmethod
    def _build_aprsis_filter(callsigns: Iterable[str]) -> str:
        """Build an APRS-IS filter string from a callsign sequence."""

        return " ".join(f"p/{callsign}" for callsign in callsigns if callsign)

    @staticmethod
    def _line_to_text(raw_line: Any) -> str:
        """Convert a raw APRS-IS line to text for filtering and parsing."""

        if isinstance(raw_line, bytes):
            return raw_line.decode("latin-1", errors="replace").strip()
        return str(raw_line).strip()

    @staticmethod
    def _should_parse_line(line: str) -> bool:
        """Return ``True`` for likely APRS packet lines."""

        if not line or line.startswith("#") or line.startswith("logresp") or line.startswith("filter"):
            return False
        return ":" in line and ">" in line

    @staticmethod
    def _coerce_float(value: Any, default: float = 0.0) -> float:
        """Coerce a value to float, returning ``default`` on failure."""

        try:
            parsed = float(value)
            if math.isfinite(parsed):
                return parsed
            return default
        except (TypeError, ValueError):
            return default

    def _extract_lat_lon(self, payload: Mapping[str, Any]) -> tuple[float | None, float | None]:
        """Extract latitude and longitude from a parsed packet payload."""

        latitude = payload.get("latitude")
        if latitude is None:
            latitude = payload.get("lat")

        longitude = payload.get("longitude")
        if longitude is None:
            longitude = payload.get("lon")
        if longitude is None:
            longitude = payload.get("lng")

        if latitude is None or longitude is None:
            return None, None

        try:
            lat = float(latitude)
            lon = float(longitude)
            if not (math.isfinite(lat) and math.isfinite(lon)):
                return None, None
            return lat, lon
        except (TypeError, ValueError):
            return None, None

    def _extract_altitude(self, payload: Mapping[str, Any]) -> float:
        """Extract altitude while preserving valid zero values."""

        altitude = payload.get("altitude")
        if altitude is None:
            altitude = payload.get("alt")
        if altitude is None:
            altitude = 0
        return self._coerce_float(altitude, 0.0)

    @staticmethod
    def _parse_timestamp(value: Any) -> datetime | None:
        """Parse a timestamp field into ``datetime`` when possible."""

        if value is None:
            return None

        try:
            if isinstance(value, (int, float)) or (isinstance(value, str) and value.isdigit()):
                return datetime.fromtimestamp(int(value), tz=timezone.utc)
        except Exception:
            return None

        text = str(value)
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"

        try:
            parsed = datetime.fromisoformat(text)
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except Exception:
            return None

    def _packet_from_aprsis(self, payload: Mapping[str, Any]) -> APRSPacket | None:
        """Convert an APRS-IS parse result into a typed callback packet."""

        latitude, longitude = self._extract_lat_lon(payload)
        if latitude is None or longitude is None:
            logger.debug("APRS-IS packet without lat/lon: %s", payload)
            return None

        callsign_value = payload.get("from")
        if callsign_value is None:
            callsign_value = payload.get("source")
        if callsign_value is None:
            callsign_value = payload.get("sender")
        if callsign_value is None:
            logger.debug("APRS-IS packet without callsign: %s", payload)
            return None

        callsign = self._normalize_callsign(str(callsign_value))
        if not callsign:
            logger.debug("APRS-IS packet with blank callsign: %s", payload)
            return None

        altitude = self._extract_altitude(payload)
        packet: APRSPacket = {
            "lat": latitude,
            "lon": longitude,
            "alt": altitude,
            "callsign": callsign,
        }

        timestamp = payload.get("timestamp")
        if timestamp is None:
            timestamp = payload.get("time")
        time_dt = self._parse_timestamp(timestamp)
        if time_dt is not None:
            packet["time_dt"] = time_dt

        logger.info(
            "APRS-IS packet for %s: lat=%s lon=%s alt=%s",
            callsign,
            latitude,
            longitude,
            altitude,
        )
        return packet

    def _packet_from_polling(self, callsign: str, payload: Mapping[str, Any]) -> APRSPacket | None:
        """Convert an aprs.fi entry into a typed callback packet."""

        latitude, longitude = self._extract_lat_lon(payload)
        if latitude is None or longitude is None:
            return None

        altitude = self._extract_altitude(payload)
        time_dt = self._parse_timestamp(payload.get("time") or payload.get("timestamp") or payload.get("time_iso"))

        packet: APRSPacket = {
            "lat": latitude,
            "lon": longitude,
            "alt": altitude,
            "callsign": self._normalize_callsign(callsign),
        }
        if time_dt is not None:
            packet["time_dt"] = time_dt

        return packet

    def _is_duplicate(self, callsign: str, time_dt: datetime | None) -> bool:
        """Return ``True`` when the packet timestamp is older than the last seen one."""

        if time_dt is None:
            return False

        key = callsign.upper()
        with self._lock:
            last_time = self._last_time.get(key)
            return last_time is not None and time_dt <= last_time

    def _remember_packet_time(self, callsign: str, time_dt: datetime | None) -> None:
        """Record the last accepted packet timestamp for a callsign."""

        if time_dt is None:
            return

        with self._lock:
            self._last_time[callsign.upper()] = time_dt

    def _emit_packet(self, packet: APRSPacket, source: str) -> None:
        """Invoke the callback with consistent error handling and bookkeeping."""

        callsign = packet.get("callsign")
        if not callsign:
            return

        try:
            self.callback(packet)
        except Exception:
            logger.exception("Error in %s callback for %s", source, callsign)
            return

        self._remember_packet_time(callsign, packet.get("time_dt"))

    def _sleep_with_stop(self, seconds: float) -> None:
        """Sleep in short intervals so ``stop()`` can interrupt quickly."""

        deadline = time.monotonic() + max(0.0, float(seconds))
        while self._running and time.monotonic() < deadline:
            time.sleep(min(1.0, deadline - time.monotonic()))
