"""The radio list of the multi-radio gateway, stored in ``radios.json``.

One entry per radio: how to reach it, where its database lives, and the public
key its worker last reported. The numeric ``id`` is the storage identity and is
never reused; the public key only names the workspace URL (see ``keys.py``).
"""

from __future__ import annotations

import contextlib
import os
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, Field

# Worker environment the gateway sets itself. A radio's ``env`` cannot override these.
RESERVED_ENV = frozenset(
    {
        "MESHCORE_MULTI_RADIO",
        "MESHCORE_SERIAL_PORT",
        "MESHCORE_SERIAL_BAUDRATE",
        "MESHCORE_TCP_HOST",
        "MESHCORE_TCP_PORT",
        "MESHCORE_BLE_ADDRESS",
        "MESHCORE_BLE_PIN",
        "MESHCORE_DATABASE_PATH",
        "MESHCORE_BASIC_AUTH_USERNAME",
        "MESHCORE_BASIC_AUTH_PASSWORD",
        "MESHCORE_WORKER_TOKEN",
    }
)


class RegistryError(ValueError):
    """A radio list change that would leave the list invalid."""


class SerialTransport(BaseModel):
    type: Literal["serial"] = "serial"
    port: str = ""  # empty = auto-detect, only allowed with a single radio
    baudrate: int = 115200

    def endpoint(self) -> tuple:
        return ("serial", self.port)

    def env(self) -> dict[str, str]:
        return {
            "MESHCORE_SERIAL_PORT": self.port,
            "MESHCORE_SERIAL_BAUDRATE": str(self.baudrate),
        }


class TcpTransport(BaseModel):
    type: Literal["tcp"] = "tcp"
    host: str = Field(min_length=1)
    port: int = Field(default=5000, ge=1, le=65535)

    def endpoint(self) -> tuple:
        return ("tcp", self.host.lower(), self.port)

    def env(self) -> dict[str, str]:
        return {"MESHCORE_TCP_HOST": self.host, "MESHCORE_TCP_PORT": str(self.port)}


class BleTransport(BaseModel):
    type: Literal["ble"] = "ble"
    address: str = Field(min_length=1)
    pin: str = Field(min_length=1)

    def endpoint(self) -> tuple:
        return ("ble", self.address.lower())

    def env(self) -> dict[str, str]:
        return {"MESHCORE_BLE_ADDRESS": self.address, "MESHCORE_BLE_PIN": self.pin}


Transport = Annotated[SerialTransport | TcpTransport | BleTransport, Field(discriminator="type")]


class RadioEntry(BaseModel):
    id: int
    name: str = Field(min_length=1, max_length=64)
    enabled: bool = True
    transport: Transport
    database_path: str
    public_key: str | None = None
    key_history: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)


class RegistryFile(BaseModel):
    version: int = 1
    next_id: int = 1
    radios: list[RadioEntry] = Field(default_factory=list)


class RadioRegistry:
    """Load, validate and save the radio list. Every change is saved at once."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._file = RegistryFile()

    @property
    def radios(self) -> list[RadioEntry]:
        return list(self._file.radios)

    def get(self, radio_id: int) -> RadioEntry | None:
        return next((r for r in self._file.radios if r.id == radio_id), None)

    def load(self) -> None:
        if self.path.exists():
            self._file = RegistryFile.model_validate_json(self.path.read_text(encoding="utf-8"))

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(self._file.model_dump_json(indent=2) + "\n", encoding="utf-8")
        # The file can hold a BLE PIN. Not every platform supports the mode.
        with contextlib.suppress(OSError):
            os.chmod(tmp, 0o600)
        os.replace(tmp, self.path)

    def bootstrap_from_settings(self, settings) -> None:
        """First start in multi-radio mode: the configured radio becomes radio 1."""
        if self._file.radios:
            return
        transport: SerialTransport | TcpTransport | BleTransport
        if settings.tcp_host:
            transport = TcpTransport(host=settings.tcp_host, port=settings.tcp_port)
        elif settings.ble_address:
            transport = BleTransport(address=settings.ble_address, pin=settings.ble_pin)
        else:
            transport = SerialTransport(
                port=settings.serial_port, baudrate=settings.serial_baudrate
            )
        self.add(name="Radio 1", transport=transport, database_path=settings.database_path)

    def add(
        self,
        *,
        name: str,
        transport: SerialTransport | TcpTransport | BleTransport,
        enabled: bool = True,
        env: dict[str, str] | None = None,
        database_path: str | None = None,
    ) -> RadioEntry:
        radio_id = self._file.next_id
        entry = RadioEntry(
            id=radio_id,
            name=name,
            enabled=enabled,
            transport=transport,
            database_path=database_path
            or (self.path.parent / "radios" / str(radio_id) / "meshcore.db").as_posix(),
            env=env or {},
        )
        self._validate([*self._file.radios, entry])
        self._file.radios.append(entry)
        self._file.next_id = radio_id + 1
        self.save()
        return entry

    def update(
        self,
        radio_id: int,
        *,
        name: str | None = None,
        transport: SerialTransport | TcpTransport | BleTransport | None = None,
        enabled: bool | None = None,
        env: dict[str, str] | None = None,
    ) -> RadioEntry:
        current = self.get(radio_id)
        if current is None:
            raise KeyError(radio_id)
        changes: dict = {}
        if name is not None:
            changes["name"] = name
        if transport is not None:
            changes["transport"] = transport
        if enabled is not None:
            changes["enabled"] = enabled
        if env is not None:
            changes["env"] = env
        updated = current.model_copy(update=changes)
        radios = [updated if r.id == radio_id else r for r in self._file.radios]
        self._validate(radios)
        self._file.radios = radios
        self.save()
        return updated

    def remove(self, radio_id: int) -> RadioEntry:
        current = self.get(radio_id)
        if current is None:
            raise KeyError(radio_id)
        self._file.radios = [r for r in self._file.radios if r.id != radio_id]
        self.save()
        return current

    def set_public_key(self, radio_id: int, public_key: str) -> bool:
        """Record the key a worker reported. Returns True when it changed."""
        current = self.get(radio_id)
        if current is None:
            raise KeyError(radio_id)
        key = public_key.lower()
        if current.public_key == key:
            return False
        history = [k for k in current.key_history if k != key]
        if current.public_key:
            history.append(current.public_key)
        updated = current.model_copy(update={"public_key": key, "key_history": history})
        self._file.radios = [updated if r.id == radio_id else r for r in self._file.radios]
        self.save()
        return True

    @staticmethod
    def _validate(radios: list[RadioEntry]) -> None:
        if len(radios) > 1 and any(
            r.transport.type == "serial" and not r.transport.port for r in radios
        ):
            raise RegistryError(
                "Serial auto-detect is only allowed with a single radio. "
                "Set an explicit serial port for every radio."
            )
        endpoints: dict[tuple, int] = {}
        paths: dict[str, int] = {}
        for radio in radios:
            endpoint = radio.transport.endpoint()
            if endpoint in endpoints:
                raise RegistryError(
                    f"Radio {radio.id} uses the same connection as radio {endpoints[endpoint]}."
                )
            endpoints[endpoint] = radio.id
            path = os.path.normcase(os.path.abspath(radio.database_path))
            if path in paths:
                raise RegistryError(
                    f"Radio {radio.id} uses the same database as radio {paths[path]}."
                )
            paths[path] = radio.id
            for key in radio.env:
                if key in RESERVED_ENV:
                    raise RegistryError(f"{key} is set by the gateway and cannot be overridden.")
