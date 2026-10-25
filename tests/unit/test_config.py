from chasemapper.config import read_config
from pathlib import Path


def test_read_example_config():
    root = Path(__file__).resolve().parents[2]
    cfg_path = root / 'horusmapper.cfg.example'
    cfg = read_config(str(cfg_path), default_cfg=str(cfg_path))
    assert cfg is not None
    assert 'flask_port' in cfg
    assert 'profiles' in cfg and isinstance(cfg['profiles'], dict)


def _write_cfg_with_osrm(tmp_path, value):
    root = Path(__file__).resolve().parents[2]
    text = (root / 'horusmapper.cfg.example').read_text()
    lines = []
    for line in text.splitlines():
        if line.strip().startswith('osrm_base_url'):
            line = 'osrm_base_url = %s' % value
        lines.append(line)
    out = tmp_path / 'test.cfg'
    out.write_text('\n'.join(lines) + '\n')
    return str(out), str(root / 'horusmapper.cfg.example')


def test_osrm_base_url_defaults_to_empty_in_example():
    root = Path(__file__).resolve().parents[2]
    cfg_path = root / 'horusmapper.cfg.example'
    cfg = read_config(str(cfg_path), default_cfg=str(cfg_path))
    assert cfg['osrm_base_url'] == ''


def test_osrm_base_url_parsed_and_trailing_slash_stripped(tmp_path):
    cfg_path, default = _write_cfg_with_osrm(tmp_path, 'http://192.168.1.10:5000/')
    cfg = read_config(cfg_path, default_cfg=default)
    assert cfg['osrm_base_url'] == 'http://192.168.1.10:5000'


def test_osrm_base_url_precedence(monkeypatch):
    import horusmapper

    monkeypatch.setattr(horusmapper, 'chasemapper_config', {'osrm_base_url': ''})
    monkeypatch.delenv('CHASEMAPPER_OSRM_BASE_URL', raising=False)
    assert horusmapper._get_osrm_base_url() == 'https://router.project-osrm.org'

    monkeypatch.setattr(horusmapper, 'chasemapper_config', {'osrm_base_url': 'http://cfg:5000'})
    assert horusmapper._get_osrm_base_url() == 'http://cfg:5000'

    monkeypatch.setenv('CHASEMAPPER_OSRM_BASE_URL', 'http://env:5000/')
    assert horusmapper._get_osrm_base_url() == 'http://env:5000'
