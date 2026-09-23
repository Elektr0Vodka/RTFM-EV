# Updated automatically when a new migration is added.  Migration tests that
# run ``run_migrations`` to completion assert ``get_version == LATEST`` and
# ``applied == LATEST - starting_version`` so only this constant needs to
# change, not every individual assertion.
#
# ``LATEST - start`` counts the migration files actually present in
# ``(start, LATEST]`` rather than doing plain arithmetic. With no gap in the
# numbering the result is identical; it only differs while parallel branches
# own non-contiguous numbers (e.g. this branch has _111 but not _108-_110).
import pkgutil
import re

import app.migrations as _migrations_pkg


def _present_migration_numbers() -> list[int]:
    numbers: list[int] = []
    for module_info in pkgutil.iter_modules(_migrations_pkg.__path__):
        match = re.match(r"_(\d+)_", module_info.name)
        if match:
            numbers.append(int(match.group(1)))
    return numbers


class _LatestSchemaVersion(int):
    def __sub__(self, other):
        if isinstance(other, int) and not isinstance(other, bool):
            return sum(1 for n in _present_migration_numbers() if other < n <= int(self))
        return NotImplemented


LATEST_SCHEMA_VERSION = _LatestSchemaVersion(111)
