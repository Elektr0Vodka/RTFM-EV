"""Tri-state flood-scope override parsing shared by channels and contacts."""

from app.region_scope import (
    UNSCOPED_OVERRIDE_MARKER,
    parse_override_input,
    resolve_override_scope,
)


def test_parse_override_input_tri_state():
    # Blank means "clear / inherit the global scope", not "unscoped".
    assert parse_override_input(None) is None
    assert parse_override_input("") is None
    assert parse_override_input("   ") is None
    # Explicit unscoped requests collapse onto the canonical marker.
    assert parse_override_input("*") == UNSCOPED_OVERRIDE_MARKER
    assert parse_override_input("0") == UNSCOPED_OVERRIDE_MARKER
    # Region names are normalized to hashtag form.
    assert parse_override_input("Esperance") == "#Esperance"
    assert parse_override_input("#Esperance") == "#Esperance"


def test_resolve_override_scope_tri_state():
    # None = inherit: the caller must leave the radio's standing scope alone.
    assert resolve_override_scope(None) == ("", False)
    # Marker = explicitly unscoped: blank scope, but the caller must apply it.
    assert resolve_override_scope(UNSCOPED_OVERRIDE_MARKER) == ("", True)
    assert resolve_override_scope("Esperance") == ("#Esperance", True)
    assert resolve_override_scope("#Esperance") == ("#Esperance", True)
