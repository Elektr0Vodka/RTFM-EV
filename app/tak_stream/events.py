"""Build Cursor-on-Target ``<event>`` XML for the TAK Stream.

One newline-terminated event per map item, in the form ATAK / WinTAK accept on a
plain TCP "network input". Pure functions; ``None`` means "do not send" (no
position, or already stale).
"""

import re
import xml.etree.ElementTree as ET
from datetime import UTC, datetime

from app.models import (
    CONTACT_TYPE_REPEATER,
    CONTACT_TYPE_ROOM,
    CONTACT_TYPE_SENSOR,
    Contact,
    TeamBeaconPoint,
    TrackerObject,
    TrackerPosition,
)

NODE_STALE_S = 3600
TRACKER_STALE_S = 900
# CoT "unknown" for height and circular / linear error.
_UNKNOWN = "9999999.0"
# Characters XML 1.0 does not allow; mesh-supplied names can carry them.
_XML_ILLEGAL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]")

_NODE_TYPES = {
    CONTACT_TYPE_REPEATER: "a-f-G-I-U-T",  # ground installation, telecom
    CONTACT_TYPE_ROOM: "a-f-G-I-U-T",
    CONTACT_TYPE_SENSOR: "a-f-G-E-S",  # ground equipment, sensor
}
_PERSON_TYPE = "a-f-G-U-C"  # friendly ground unit


def _stamp(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _clean(text: str) -> str:
    return _XML_ILLEGAL.sub("", text)


def cot_event_xml(
    uid: str,
    cot_type: str,
    lat: float,
    lon: float,
    callsign: str,
    time_s: int,
    stale_s: int,
    team: str | None = None,
    speed_mps: float | None = None,
    course_deg: float | None = None,
    remarks: str | None = None,
) -> bytes:
    uid, cot_type, callsign = _clean(uid), _clean(cot_type), _clean(callsign)
    team = _clean(team) if team else team
    remarks = _clean(remarks) if remarks else remarks
    event = ET.Element(
        "event",
        {
            "version": "2.0",
            "uid": uid,
            "type": cot_type,
            "how": "m-g",
            "time": _stamp(time_s),
            "start": _stamp(time_s),
            "stale": _stamp(stale_s),
        },
    )
    ET.SubElement(
        event,
        "point",
        {
            "lat": repr(float(lat)),
            "lon": repr(float(lon)),
            "hae": _UNKNOWN,
            "ce": _UNKNOWN,
            "le": _UNKNOWN,
        },
    )
    detail = ET.SubElement(event, "detail")
    ET.SubElement(detail, "contact", {"callsign": callsign})
    if team:
        ET.SubElement(detail, "__group", {"name": team, "role": "Team Member"})
    if speed_mps is not None or course_deg is not None:
        ET.SubElement(
            detail,
            "track",
            {"speed": repr(float(speed_mps or 0.0)), "course": repr(float(course_deg or 0.0))},
        )
    if remarks:
        ET.SubElement(detail, "remarks").text = remarks
    return ET.tostring(event, encoding="utf-8", xml_declaration=False) + b"\n"


def _valid(lat: float | None, lon: float | None) -> bool:
    if lat is None or lon is None:
        return False
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return False
    return not (lat == 0 and lon == 0)


def contact_event(c: Contact, now: int) -> bytes | None:
    """A positioned node; the advertised location wins over a manual one, as on the map."""
    if _valid(c.lat, c.lon):
        lat, lon = c.lat, c.lon
    elif _valid(c.manual_lat, c.manual_lon):
        lat, lon = c.manual_lat, c.manual_lon
    else:
        return None
    if c.last_seen is None or c.last_seen + NODE_STALE_S < now:
        return None
    assert lat is not None and lon is not None
    return cot_event_xml(
        uid=f"RTFM-EV-{c.public_key[:12].lower()}",
        cot_type=_NODE_TYPES.get(c.type, _PERSON_TYPE),
        lat=lat,
        lon=lon,
        callsign=c.name or c.public_key[:12],
        time_s=now,
        stale_s=c.last_seen + NODE_STALE_S,
    )


def tracker_event(p: TrackerPosition, now: int) -> bytes | None:
    stale = p.received_at + TRACKER_STALE_S
    if stale < now:
        return None
    if p.cot_uid:
        uid = p.cot_uid
    elif p.source == "atak":
        uid = f"RTFM-EV-ATAK-{p.identity}"
    else:
        uid = f"RTFM-EV-SAR-{p.identity}"
    return cot_event_xml(
        uid=uid,
        cot_type=_PERSON_TYPE,
        lat=p.lat,
        lon=p.lon,
        callsign=p.display_name or p.identity,
        time_s=now,
        stale_s=stale,
        team=p.team,
        speed_mps=p.speed_mps,
        course_deg=p.course_deg,
    )


def object_event(o: TrackerObject, now: int) -> bytes | None:
    stale = o.stale_at if o.stale_at is not None else o.received_at + TRACKER_STALE_S
    if stale < now:
        return None
    return cot_event_xml(
        uid=o.uid,
        cot_type=o.cot_type,
        lat=o.lat,
        lon=o.lon,
        callsign=o.callsign or o.uid,
        time_s=now,
        stale_s=stale,
        remarks=o.remarks,
    )


def team_beacon_event(b: TeamBeaconPoint, now: int) -> bytes | None:
    stale = b.received_at + TRACKER_STALE_S
    if stale < now:
        return None
    identity = (b.sender_key or "")[:12] or (b.sender_name or str(b.message_id))
    return cot_event_xml(
        uid=f"RTFM-EV-TEAM-{identity}",
        cot_type=_PERSON_TYPE,
        lat=b.lat,
        lon=b.lon,
        callsign=b.sender_name or identity,
        time_s=now,
        stale_s=stale,
    )
