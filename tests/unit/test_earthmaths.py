import pytest
from chasemapper.earthmaths import position_info, bearing_to_cardinal


def test_position_info_small_distance():
    listener = (0.0, 0.0, 0.0)
    balloon = (0.0, 0.001, 0.0)
    info = position_info(listener, balloon)

    assert info["great_circle_distance"] > 0
    # For very small separations, straight distance ~= great circle distance
    assert pytest.approx(info["straight_distance"], rel=1e-3) == info["great_circle_distance"]


def test_bearing_to_cardinal_mappings():
    assert bearing_to_cardinal(0) == "N"
    assert bearing_to_cardinal(45) == "NE"
    assert bearing_to_cardinal(180) == "S"
    assert bearing_to_cardinal(22.5) == "NNE"
    assert bearing_to_cardinal(359) == "N"
