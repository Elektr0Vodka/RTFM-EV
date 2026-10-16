"""meshcomod's built-in "Meshcomod" command contact.

meshcomod companion firmware lists this contact after every contact sync. Its
key is "MESHCM" padded with zeros. A DM to it runs on the radio itself (wifi,
tcp, ble, ota, status, ...) and never goes out over LoRa; the radio confirms the
send at once and answers with plain DMs from the same prefix. No imports, so
the fanout, push and radio code can all use it.
"""

MESHCOMOD_COMMAND_CONTACT_PREFIX = "4d455348434d"
# The full key the radio lists: the firmware zeroes the rest of the key.
MESHCOMOD_COMMAND_CONTACT_KEY = MESHCOMOD_COMMAND_CONTACT_PREFIX + "0" * 52


def is_meshcomod_command_contact(public_key: str | None) -> bool:
    """True for meshcomod's local command contact (matched on its 6-byte prefix)."""
    return public_key is not None and public_key.lower().startswith(
        MESHCOMOD_COMMAND_CONTACT_PREFIX
    )


MESHCOMOD_COMMAND_CONTACT_DETAIL = (
    "This is meshcomod's command contact: it runs on your radio and is not a node "
    "on the mesh. Send it a message instead (help lists the commands)."
)
