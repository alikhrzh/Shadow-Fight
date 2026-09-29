import pytest

from shadowcoach.analysis.geometry import angle_degrees, distance, straightness


@pytest.mark.parametrize(
    ("a", "b", "c", "expected"),
    [
        ((-1, 0), (0, 0), (1, 0), 180),
        ((1, 0), (0, 0), (0, 1), 90),
        ((1, 0, 0), (0, 0, 0), (0, 0, 1), 90),
    ],
)
def test_angles(a, b, c, expected):
    assert angle_degrees(a, b, c) == pytest.approx(expected)


def test_degenerate_angle_is_missing_not_zero():
    assert angle_degrees((1, 1), (1, 1), (2, 2)) is None


def test_distance_and_curve():
    assert distance((0, 0), (3, 4)) == 5
    assert straightness([(0, 0), (1, 0), (2, 0)]) == 1
    assert straightness([(0, 0), (1, 1), (2, 0)]) < 0.8
    assert straightness([(0, 0), (0, 0)]) is None
