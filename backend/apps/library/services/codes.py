"""Pure helpers for category prefixes and accession and copy codes. No model imports,
so the data migration can use them safely."""
import re

CATEGORY_CODE_MAX_LENGTH = 8
CATEGORY_CODE_PATTERN = re.compile(r"^[A-Z0-9]{1,8}$")


def code_from_name(name, taken=()):
    """Derive an uppercase prefix from a category name that is not in `taken`.

    "Fiction" gives FIC. When FIC is taken the next free of FIC2, FIC3 and so on
    is used. A name with no letters or digits falls back to CAT.
    """
    taken = {code.upper() for code in taken if code}
    alnum = re.sub(r"[^A-Za-z0-9]", "", name or "").upper()
    base = alnum[:3] or "CAT"
    if base not in taken:
        return base
    for suffix in range(2, 1000):
        candidate = f"{base}{suffix}"[:CATEGORY_CODE_MAX_LENGTH]
        if candidate not in taken:
            return candidate
    raise ValueError("No free category code")


def format_accession_code(category_code, sequence):
    return f"LIB-{category_code}-{sequence:04d}"


def format_copy_code(accession_code, copy_number):
    return f"{accession_code}/C{copy_number}"


def copy_number_from_code(code):
    match = re.search(r"/C(\d+)$", code or "")
    return int(match.group(1)) if match else 0
