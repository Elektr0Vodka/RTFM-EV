"""Response timeouts for request/response operations sent to a contact.

A request over a known route crosses every hop on the way out and the answer
crosses them again on the way back, so a fixed wait that fits a neighbour is too
short for a contact three repeaters away. Giving up early costs more than the
wait: a login that times out on its route resets the path and repeats as a
flood, which occupies the whole mesh instead of one path.

Adapted from the ``f3sty/Remote-Terminal-for-MeshCore`` fork (``5267f857``,
``891a452f``).
"""

from app.models import Contact

# Extra wait per physical radio hop on a known route.
ROUTE_TIMEOUT_HOP_SECONDS = 5.0
# Ceiling, so a long explicit route cannot hold the radio lock for minutes.
ROUTE_TIMEOUT_MAX_SECONDS = 30.0


def contact_timeout_seconds(
    contact: Contact,
    *,
    flood_timeout: float,
    max_timeout: float = ROUTE_TIMEOUT_MAX_SECONDS,
) -> float:
    """Return the response timeout for the contact's effective route.

    ``flood_timeout`` is the wait used so far for every route, and stays the
    wait for a flood: a flood has no known hop count to scale by. A known route
    (learned or a routing override) adds ``ROUTE_TIMEOUT_HOP_SECONDS`` per
    physical hop. ``path_len`` counts the repeaters on the path, so 0 is still
    one radio hop and gets one share. The result never drops below
    ``flood_timeout`` and is capped at ``max_timeout`` unless ``flood_timeout``
    itself is higher.
    """
    route = contact.effective_route
    if contact.effective_route_source == "flood" or route is None or route.path_len < 0:
        return flood_timeout

    physical_hops = route.path_len + 1
    scaled = flood_timeout + physical_hops * ROUTE_TIMEOUT_HOP_SECONDS
    return max(flood_timeout, min(max_timeout, scaled))
