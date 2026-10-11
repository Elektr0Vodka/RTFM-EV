from app.models import Contact
from app.services.route_timeout import (
    ROUTE_TIMEOUT_HOP_SECONDS,
    ROUTE_TIMEOUT_MAX_SECONDS,
    contact_timeout_seconds,
)

KEY = "aa" * 32


def test_flood_keeps_baseline_timeout():
    contact = Contact(public_key=KEY)

    assert contact.effective_route_source == "flood"
    assert contact_timeout_seconds(contact, flood_timeout=5.0) == 5.0


def test_zero_length_known_route_is_still_one_physical_hop():
    contact = Contact(
        public_key=KEY,
        direct_path="",
        direct_path_len=0,
        direct_path_hash_mode=0,
    )

    assert contact_timeout_seconds(contact, flood_timeout=10.0) == 15.0


def test_known_direct_route_adds_one_share_per_physical_hop():
    contact = Contact(
        public_key=KEY,
        direct_path="aabb",
        direct_path_len=2,
        direct_path_hash_mode=0,
    )

    # Two repeaters on the path are three radio hops.
    assert (
        contact_timeout_seconds(contact, flood_timeout=5.0) == 5.0 + 3 * ROUTE_TIMEOUT_HOP_SECONDS
    )


def test_long_route_is_capped():
    contact = Contact(
        public_key=KEY,
        direct_path="aabbccddeeff0011",
        direct_path_len=8,
        direct_path_hash_mode=0,
    )

    assert contact_timeout_seconds(contact, flood_timeout=10.0) == ROUTE_TIMEOUT_MAX_SECONDS


def test_route_override_is_scaled_and_bounded():
    contact = Contact(
        public_key=KEY,
        route_override_path="aabbcc",
        route_override_len=3,
        route_override_hash_mode=0,
    )

    assert contact.effective_route_source == "override"
    assert contact_timeout_seconds(contact, flood_timeout=10.0, max_timeout=20.0) == 20.0


def test_forced_flood_override_keeps_baseline_timeout():
    contact = Contact(
        public_key=KEY,
        direct_path="aabb",
        direct_path_len=2,
        direct_path_hash_mode=0,
        route_override_path="",
        route_override_len=-1,
        route_override_hash_mode=-1,
    )

    assert contact.effective_route is not None
    assert contact.effective_route.path_len == -1
    assert contact_timeout_seconds(contact, flood_timeout=10.0) == 10.0


def test_baseline_above_the_cap_is_never_shortened():
    contact = Contact(
        public_key=KEY,
        direct_path="aabb",
        direct_path_len=2,
        direct_path_hash_mode=0,
    )

    assert contact_timeout_seconds(contact, flood_timeout=45.0) == 45.0
