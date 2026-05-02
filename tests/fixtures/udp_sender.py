import socket
import time

def send_udp(host: str, port: int, data, delay: float = 0.0):
    """Send a single UDP datagram to host:port.

    - data may be bytes or str.
    - delay is a short sleep after sending (seconds).
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        payload = data if isinstance(data, (bytes, bytearray)) else str(data).encode()
        s.sendto(payload, (host, port))
        if delay:
            time.sleep(delay)
    finally:
        try:
            s.close()
        except Exception:
            pass
