"""Dutch RD New (Rijksdriehoeksstelsel, EPSG:28992) to WGS84 conversion.

The Antenneregister WFS only serves RD New coordinates. This is the published
polynomial approximation (Schreutelkamp and Strang van Hees), accurate to about
a metre inside the Netherlands, which is far below the register's own stated
15 m position accuracy. A pure-Python port avoids adding pyproj for one layer.
"""

_X0 = 155000.0
_Y0 = 463000.0
_PHI0 = 52.15517440
_LAM0 = 5.38720621

# (p, q, coefficient): dX^p * dY^q terms, result in arc seconds.
_K = (
    (0, 1, 3235.65389),
    (2, 0, -32.58297),
    (0, 2, -0.24750),
    (2, 1, -0.84978),
    (0, 3, -0.06550),
    (2, 2, -0.01709),
    (1, 0, -0.00738),
    (4, 0, 0.00530),
    (2, 3, -0.00039),
    (4, 1, 0.00033),
    (1, 1, -0.00012),
)
_L = (
    (1, 0, 5260.52916),
    (1, 1, 105.94684),
    (1, 2, 2.45656),
    (3, 0, -0.81885),
    (1, 3, 0.05594),
    (3, 1, -0.05607),
    (0, 1, 0.01199),
    (3, 2, -0.00256),
    (1, 4, 0.00128),
    (0, 2, 0.00022),
    (2, 0, -0.00022),
    (5, 0, 0.00026),
)


def rd_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """Convert RD New metres ``(x, y)`` to WGS84 ``(lat, lon)`` in degrees."""
    dx = (x - _X0) * 1e-5
    dy = (y - _Y0) * 1e-5
    lat = _PHI0 + sum(k * dx**p * dy**q for p, q, k in _K) / 3600.0
    lon = _LAM0 + sum(k * dx**p * dy**q for p, q, k in _L) / 3600.0
    return lat, lon
