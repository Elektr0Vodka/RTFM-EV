"""CoT event XML built for the TAK Stream."""

import xml.etree.ElementTree as ET

from app.models import (
    CONTACT_TYPE_CLIENT,
    CONTACT_TYPE_REPEATER,
    Contact,
    TrackerObject,
    TrackerPosition,
)
from app.tak_stream.events import contact_event, cot_event_xml, object_event, tracker_event

NOW = 1_792_412_100  # 2026-10-19T12:15:00Z
KEY = "ab12cd34ef56" + "00" * 26


def _parse(raw: bytes) -> ET.Element:
    assert raw.endswith(b"\n")
    return ET.fromstring(raw)


def test_event_xml_shape():
    root = _parse(
        cot_event_xml(
            uid="X-1",
            cot_type="a-f-G-U-C",
            lat=52.1,
            lon=5.2,
            callsign="Node <1>",
            time_s=NOW,
            stale_s=NOW + 900,
            team="Cyan",
            speed_mps=1.5,
            course_deg=90.0,
            remarks="hello & bye",
        )
    )
    assert root.tag == "event"
    assert root.get("version") == "2.0"
    assert root.get("uid") == "X-1"
    assert root.get("type") == "a-f-G-U-C"
    assert root.get("how") == "m-g"
    assert root.get("time") == "2026-10-19T12:15:00.000Z"
    assert root.get("start") == "2026-10-19T12:15:00.000Z"
    assert root.get("stale") == "2026-10-19T12:30:00.000Z"
    point = root.find("point")
    assert point is not None
    assert (point.get("lat"), point.get("lon")) == ("52.1", "5.2")
    assert root.find("detail/contact").get("callsign") == "Node <1>"
    assert root.find("detail/__group").get("name") == "Cyan"
    track = root.find("detail/track")
    assert (track.get("speed"), track.get("course")) == ("1.5", "90.0")
    assert root.find("detail/remarks").text == "hello & bye"


def test_event_xml_optional_parts_left_out():
    root = _parse(cot_event_xml("X", "a-f-G", 1.0, 2.0, "N", NOW, NOW + 60))
    assert root.find("detail/__group") is None
    assert root.find("detail/track") is None
    assert root.find("detail/remarks") is None


def _contact(**fields) -> Contact:
    base = {"public_key": KEY, "name": "Node A", "type": CONTACT_TYPE_CLIENT, "last_seen": NOW - 60}
    base.update(fields)
    return Contact(**base)


def test_contact_event_companion():
    root = _parse(contact_event(_contact(lat=52.0, lon=5.0), NOW))
    assert root.get("uid") == "RTFM-EV-ab12cd34ef56"
    assert root.get("type") == "a-f-G-U-C"
    assert root.find("detail/contact").get("callsign") == "Node A"
    assert root.get("stale") == "2026-10-19T13:14:00.000Z"  # last_seen + 1 h


def test_contact_event_repeater_type():
    root = _parse(contact_event(_contact(lat=52.0, lon=5.0, type=CONTACT_TYPE_REPEATER), NOW))
    assert root.get("type") == "a-f-G-I-U-T"


def test_contact_event_advertised_location_wins():
    root = _parse(contact_event(_contact(lat=52.0, lon=5.0, manual_lat=10.0, manual_lon=11.0), NOW))
    assert root.find("point").get("lat") == "52.0"


def test_contact_event_manual_location_fallback():
    root = _parse(contact_event(_contact(lat=0.0, lon=0.0, manual_lat=10.0, manual_lon=11.0), NOW))
    assert (root.find("point").get("lat"), root.find("point").get("lon")) == ("10.0", "11.0")


def test_contact_event_expired_none():
    assert contact_event(_contact(lat=52.0, lon=5.0, last_seen=NOW - 3601), NOW) is None


def test_contact_event_without_location_none():
    assert contact_event(_contact(), NOW) is None


def _position(**fields) -> TrackerPosition:
    base = {
        "source": "atak",
        "identity": "JESTER_25",
        "display_name": "JESTER_25",
        "lat": 52.0,
        "lon": 5.0,
        "received_at": NOW - 10,
    }
    base.update(fields)
    return TrackerPosition(**base)


def test_tracker_event_atak_uid():
    root = _parse(tracker_event(_position(team="Cyan", speed_mps=2.0, course_deg=45.0), NOW))
    assert root.get("uid") == "ANDROID-JESTER_25"
    assert root.find("detail/__group").get("name") == "Cyan"
    assert root.get("stale") == "2026-10-19T12:29:50.000Z"  # received + 15 min


def test_tracker_event_sar_uid():
    root = _parse(
        tracker_event(
            _position(source="sar_fast_gps", identity="a1b2c3d4e5f6", display_name="Rescue 1"), NOW
        )
    )
    assert root.get("uid") == "RTFM-EV-SAR-a1b2c3d4e5f6"
    assert root.find("detail/contact").get("callsign") == "Rescue 1"


def test_tracker_event_expired_none():
    assert tracker_event(_position(received_at=NOW - 901), NOW) is None


def test_object_event_keeps_uid_and_stale():
    obj = TrackerObject(
        uid="u-1",
        cot_type="a-h-G",
        callsign="OP",
        lat=52.0,
        lon=5.0,
        remarks="r",
        stale_at=NOW + 120,
        received_at=NOW - 5,
    )
    root = _parse(object_event(obj, NOW))
    assert root.get("uid") == "u-1"
    assert root.get("type") == "a-h-G"
    assert root.get("stale") == "2026-10-19T12:17:00.000Z"
    assert root.find("detail/remarks").text == "r"


def test_object_event_stale_none():
    obj = TrackerObject(
        uid="u", cot_type="a-h-G", lat=1.0, lon=2.0, stale_at=NOW - 1, received_at=NOW - 5
    )
    assert object_event(obj, NOW) is None
