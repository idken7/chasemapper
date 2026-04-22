#!/usr/bin/env python3
"""Try APRS-IS streaming (aprslib) against multiple hosts and print packets.

This script attempts to connect anonymously to several APRS-IS servers,
sends simple `filter p/<callsign>` filters for KF6RFX-2 and KF6RFX-14,
and listens for a short window to print any received position packets.
"""
import socket
import time
import sys

WATCH = ["KF6RFX-2", "KF6RFX-14"]
HOSTS = [("rotate.aprs.net", 60), ("noam.aprs.net", 20), ("euro.aprs.net", 20)]
PORT = 14580

try:
    import aprslib
    have_aprslib = True
except Exception:
    have_aprslib = False


def try_host(host, port, watch, timeout=30):
    print(f"Trying {host}:{port} (aprslib={'yes' if have_aprslib else 'no'})")
    try:
        s = socket.create_connection((host, port), timeout=10)
    except Exception as e:
        print(" connect failed:", e)
        return []

    results = []
    try:
        s.settimeout(1.0)
        f = s.makefile("rw", encoding="utf-8", newline='\r\n')
        # Anonymous login
        login = 'user NOCALL pass -1 vers chasemapper 1.0\r\n'
        f.write(login)
        f.flush()

        for cs in watch:
            try:
                f.write(f'filter p/{cs}\r\n')
            except Exception:
                pass
        f.flush()

        deadline = time.time() + timeout
        buf = ""
        while time.time() < deadline:
            try:
                chunk = s.recv(4096)
                if not chunk:
                    break
                text = chunk.decode("utf-8", errors="ignore")
                buf += text
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    line = line.strip('\r')
                    if not line:
                        continue
                    if have_aprslib:
                        try:
                            pkt = aprslib.parse(line)
                        except Exception:
                            pkt = None
                    else:
                        pkt = None

                    # crude check: look for callsign text in line
                    for cs in watch:
                        if cs.upper() in line.upper() or (pkt and (pkt.get('from') == cs or pkt.get('source') == cs)):
                            print("MATCH:", cs, "-> raw:", line)
                            if pkt:
                                print(" PARSED:", pkt)
                            results.append((cs, line, pkt))
            except socket.timeout:
                continue
            except Exception as e:
                print(" read error:", e)
                break

    finally:
        try:
            s.close()
        except Exception:
            pass

    return results


def main():
    all_results = []
    for h, t in HOSTS:
        r = try_host(h, PORT, WATCH, timeout=t)
        if r:
            all_results.extend(r)
            break

    if not all_results:
        print("No APRS-IS beacons seen from hosts tried.")
    else:
        print(f"Collected {len(all_results)} matches")


if __name__ == '__main__':
    main()
