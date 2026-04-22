#!/usr/bin/env python3
"""
Simple APRS.fi poll-based tracker.

This module provides APRSTracker, a background thread which periodically
polls the aprs.fi API for a list of callsigns and invokes a callback with
position updates. It is intentionally lightweight and uses `requests` so
no extra dependency is required beyond the existing requirements.

If you have an APRS.fi API key, set it in the config and it will be used.
"""
from threading import Thread
import time
import requests
from dateutil.parser import parse as parse_dt
import logging
import socket


class APRSTracker(Thread):
    def __init__(self, callsigns, poll_interval, callback, api_key=None):
        super(APRSTracker, self).__init__()
        self.callsigns = list(callsigns)
        self.poll_interval = max(5, int(poll_interval))
        self.callback = callback
        self.api_key = api_key if api_key and api_key != "none" else None
        self._running = False
        # Track last timestamp seen per callsign to avoid duplicates
        self._last_time = {}
        # Simple lock for callsign updates
        try:
            from threading import RLock
            self._lock = RLock()
        except Exception:
            self._lock = None

    def stop(self):
        logging.info('Stopping APRS tracker')
        self._running = False

    def run(self):
        logging.info("APRS tracker started for: %s", ",".join(self.callsigns))
        self._running = True

        # Prefer APRS-IS streaming via aprslib when available. Fall back to
        # aprs.fi HTTP polling if aprslib isn't installed or the connection fails.
        use_is = False
        try:
            import aprslib  # local import so package not required at module import
            use_is = True
        except Exception:
            logging.info("aprslib not available, falling back to aprs.fi polling")

        if use_is:
            try:
                host = 'rotate.aprs.net'
                port = 14580
                s = socket.create_connection((host, port), timeout=15)
                f = s.makefile('rw', encoding='utf-8', newline='\r\n')
                # Anonymous login
                login = 'user NOCALL pass -1 vers chasemapper 1.0\r\n'
                f.write(login)
                f.flush()

                # Apply simple filters (one per callsign)
                if self._lock:
                    with self._lock:
                        filters = list(self.callsigns)
                else:
                    filters = list(self.callsigns)

                for cs in filters:
                    if not cs:
                        continue
                    try:
                        f.write('filter p/{}\r\n'.format(cs))
                    except Exception:
                        pass
                f.flush()

                logging.info("APRS-IS connected to %s:%d (anonymous), listening for %d callsigns", host, port, len(filters))
                logging.debug("APRS-IS filters: %s", filters)

                # Read lines and parse via aprslib.parse
                while self._running:
                    line = f.readline()
                    if not line:
                        break
                    line = line.strip()
                    if line == '':
                        continue
                    logging.debug('APRS-IS raw line: %s', line)
                    try:
                        pkt = aprslib.parse(line)
                        lat = pkt.get('latitude') or pkt.get('lat')
                        lon = pkt.get('longitude') or pkt.get('lon') or pkt.get('lng')
                        if lat is None or lon is None:
                            logging.debug('APRS-IS packet without lat/lon: %s', pkt)
                            continue
                        callsign = pkt.get('from') or pkt.get('source') or pkt.get('sender')
                        alt = pkt.get('altitude') or pkt.get('alt') or 0
                        output = {'lat': float(lat), 'lon': float(lon), 'alt': float(alt if alt is not None else 0), 'callsign': callsign}
                        if 'timestamp' in pkt:
                            try:
                                output['time_dt'] = parse_dt(pkt['timestamp'])
                            except Exception:
                                pass
                        try:
                            logging.info('APRS-IS packet for %s: lat=%s lon=%s alt=%s', callsign, output['lat'], output['lon'], output['alt'])
                            self.callback(output)
                        except Exception as e:
                            logging.error('Error in APRS-IS callback: %s', str(e))
                    except Exception as e:
                        logging.debug('APRS-IS parse error: %s -- raw: %s', str(e), line)
                        # Ignore parse errors and continue
                        continue

                try:
                    f.close()
                except Exception:
                    pass
                try:
                    s.close()
                except Exception:
                    pass

            except Exception as e:
                logging.error('APRS-IS connection failed: %s, falling back to aprs.fi polling', str(e))
                use_is = False

        # If APRS-IS isn't available or failed, do HTTP polling
        if not use_is:
            logging.info('Starting aprs.fi polling loop')
            while self._running:
                # Copy the callsigns under lock to allow runtime modification
                if self._lock:
                    with self._lock:
                        _calls = list(self.callsigns)
                else:
                    _calls = list(self.callsigns)

                for cs in _calls:
                    if not self._running:
                        break
                    try:
                        logging.debug('APRS polling request for %s', cs)
                        params = {
                            'name': cs,
                            'what': 'loc',
                            'format': 'json',
                        }
                        if self.api_key:
                            params['apikey'] = self.api_key

                        resp = requests.get('https://api.aprs.fi/api/get', params=params, timeout=10)
                        logging.debug('APRS response for %s: status=%s', cs, resp.status_code)
                        if resp.status_code != 200:
                            logging.warning('APRS non-200 response for %s: %s', cs, resp.status_code)
                            continue

                        j = resp.json()
                        entries = j.get('entries') or j.get('result') or []
                        if not entries:
                            logging.debug('APRS: no entries for %s', cs)
                            continue

                        entry = entries[0]
                        lat = entry.get('lat') or entry.get('latitude') or None
                        lon = entry.get('lng') or entry.get('lon') or entry.get('longitude') or None
                        alt = entry.get('alt') or entry.get('altitude') or 0
                        time_str = entry.get('time') or entry.get('timestamp') or entry.get('time_iso')

                        if lat is None or lon is None:
                            continue

                        try:
                            lat = float(lat)
                            lon = float(lon)
                        except Exception:
                            continue

                        try:
                            alt = float(alt)
                        except Exception:
                            alt = 0.0

                        try:
                            time_dt = None
                            if time_str is not None:
                                if isinstance(time_str, (int, float)) or (isinstance(time_str, str) and time_str.isdigit()):
                                    time_dt = parse_dt(time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(int(time_str))))
                                else:
                                    time_dt = parse_dt(time_str)
                        except Exception:
                            time_dt = None

                        key = cs.upper()
                        last = self._last_time.get(key)
                        if time_dt and last and time_dt <= last:
                            continue

                        output = {'lat': lat, 'lon': lon, 'alt': alt, 'callsign': cs}
                        if time_dt:
                            output['time_dt'] = time_dt

                        try:
                            logging.info('APRS packet for %s: lat=%s lon=%s alt=%s time=%s', cs, lat, lon, alt, time_dt)
                            self.callback(output)
                            if time_dt:
                                self._last_time[key] = time_dt
                        except Exception as e:
                            logging.error('Error in APRS callback: %s', str(e))

                    except Exception as e:
                        # Pre-format the message so formatting placeholders are not left in the
                        # log record if a handler does not apply the args.
                        logging.warning('APRS polling error for %s: %s' % (cs, e))

                    time.sleep(0.5)

                for _ in range(max(1, int(self.poll_interval))):
                    if not self._running:
                        break
                    time.sleep(1)

            logging.info('APRS polling stopped')

    # Runtime modification helpers
    def add_callsign(self, callsign):
        c = callsign.strip()
        if c == "":
            return
        if self._lock:
            with self._lock:
                if c not in self.callsigns:
                    self.callsigns.append(c)
                    logging.info('APRS added callsign: %s', c)
        else:
            if c not in self.callsigns:
                self.callsigns.append(c)
                logging.info('APRS added callsign: %s', c)

    def remove_callsign(self, callsign):
        c = callsign.strip()
        if self._lock:
            with self._lock:
                try:
                    self.callsigns.remove(c)
                    logging.info('APRS removed callsign: %s', c)
                except ValueError:
                    pass
        else:
            try:
                self.callsigns.remove(c)
                logging.info('APRS removed callsign: %s', c)
            except ValueError:
                pass

    def set_callsigns(self, callsigns):
        if self._lock:
            with self._lock:
                self.callsigns = list(callsigns)
                logging.info('APRS set callsigns: %s', ','.join(self.callsigns))
        else:
            self.callsigns = list(callsigns)
            logging.info('APRS set callsigns: %s', ','.join(self.callsigns))
