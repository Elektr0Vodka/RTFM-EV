"""Small SNMPv2c implementation (read-only: GET, GETNEXT, GETBULK, Response).

Written for the MeshCore observer firmware's SNMP agent, which serves a short
list of scalar OIDs. It is not a general SNMP stack: no SNMPv1, no SNMPv3, no
SET, no traps.

- ``ber``     BER encode/decode for the value types SNMPv2c uses.
- ``message`` SNMPv2c message framing.
- ``mib``     The MeshCore OID table.
- ``client``  Async UDP GET.
"""
