import pkgutil
import re

import app.migrations as _migrations_pkg


def _discovered_migration_numbers() -> list[int]:
    numbers = []
    for module_info in pkgutil.iter_modules(_migrations_pkg.__path__):
        match = re.match(r"_(\d+)_", module_info.name)
        if match:
            numbers.append(int(match.group(1)))
    return numbers


class _SchemaVersion(int):
    """The latest schema version, tolerant of gaps in migration numbering.

    Migration numbers are reserved per branch, so a branch can carry a later
    number before an earlier one has merged (for example ``_109`` before
    ``_108``). The runner then applies fewer migrations than the version span.
    ``LATEST_SCHEMA_VERSION - start`` therefore returns the number of migration
    files numbered above ``start`` (what ``run_migrations`` applies), which
    equals the plain difference when there is no gap. Everything else behaves
    like a plain int.
    """

    def __sub__(self, other: object) -> int:
        if isinstance(other, int):
            return sum(1 for num in _discovered_migration_numbers() if other < num <= self)
        return NotImplemented


# Updated automatically when a new migration is added.  Migration tests that
# run ``run_migrations`` to completion assert ``get_version == LATEST`` and
# ``applied == LATEST - starting_version`` so only this constant needs to
# change, not every individual assertion.
LATEST_SCHEMA_VERSION = _SchemaVersion(109)
