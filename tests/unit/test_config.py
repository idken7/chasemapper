from chasemapper.config import read_config
from pathlib import Path


def test_read_example_config():
    root = Path(__file__).resolve().parents[2]
    cfg_path = root / 'horusmapper.cfg.example'
    cfg = read_config(str(cfg_path), default_cfg=str(cfg_path))
    assert cfg is not None
    assert 'flask_port' in cfg
    assert 'profiles' in cfg and isinstance(cfg['profiles'], dict)
