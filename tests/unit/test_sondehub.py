from chasemapper.sondehub import SondehubChaseUploader


class DummyResp:
    def __init__(self, code=200, text='OK'):
        self.status_code = code
        self.text = text


def test_upload_position_and_mark_recovered(monkeypatch):
    called = {}

    def fake_put(url, json, timeout, headers):
        called['url'] = url
        called['json'] = json
        return DummyResp(200, 'OK')

    monkeypatch.setattr('requests.put', fake_put)

    su = SondehubChaseUploader(update_rate=1, callsign='TEST', upload_enabled=False)

    # Directly call upload_position
    su.upload_position('TEST', 12.0, 13.0, 5.0)
    assert 'url' in called

    # mark_payload_recovered returns early when serial None
    su.mark_payload_recovered(serial=None)

    # Now test recovery with a serial present
    called.clear()
    su.mark_payload_recovered(serial='ABC123', callsign='TEST', lat=1.0, lon=2.0, alt=3.0, message='Found')
    assert 'url' in called

    su.close()
