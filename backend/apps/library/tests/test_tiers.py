"""Library permission catalogue and tier map (blueprint 3.6, 3.7)."""
from io import StringIO

import pytest
from django.core.management import call_command

from apps.access_control.management.commands.seed_module_tiers import (
    LIBRARY_MANAGE_CODES,
    LIBRARY_OPERATE_CODES,
    TIER_ORDER,
    classify,
    classify_for_module,
    classify_library,
)
from apps.access_control.management.commands.seed_permissions import PERMISSIONS
from apps.access_control.models import AccessTier, ModuleAccessTier

LIBRARY_CODES = sorted(code for code, _name, module in PERMISSIONS if module == "library")

BLUEPRINT_CODES = {
    "console": ["view"],
    "book_categories": ["view", "create", "update", "delete"],
    "books": ["view", "create", "update", "delete", "import"],
    "book_copies": ["view", "update", "withdraw"],
    "library_members": ["view", "create", "update", "delete"],
    "book_issues": ["view", "issue", "return", "renew", "waive_fine", "remind"],
    "holds": ["view", "create", "cancel"],
    "lost_damaged": ["view", "create", "update", "resolve"],
    "charges": ["view", "collect", "waive"],
    "purchase_orders": ["view", "create", "update", "delete"],
    "donations": ["view", "create", "update"],
    "budgets": ["view", "manage"],
    "book_requests": ["view", "review"],
    "periods": ["view", "manage"],
    "visits": ["check_in"],
    "stock_audits": ["view", "run"],
    "activity_logs": ["view", "export"],
    "reports": ["view"],
    "settings": ["view", "manage"],
}


def test_catalogue_matches_blueprint_3_6_exactly():
    expected = sorted(f"library.{res}.{act}" for res, acts in BLUEPRINT_CODES.items() for act in acts)
    assert LIBRARY_CODES == expected


def test_codes_are_unique_and_fit_the_column():
    codes = [code for code, _name, _module in PERMISSIONS]
    assert len(codes) == len(set(codes))
    assert max(len(code) for code in codes) <= 120


def buckets():
    out = {tier: set() for tier in TIER_ORDER}
    for code in LIBRARY_CODES:
        out[classify_library(code)].add(code)
    return out


def test_every_library_code_is_in_exactly_one_tier():
    found = buckets()
    flat = [code for tier in TIER_ORDER for code in found[tier]]
    assert sorted(flat) == LIBRARY_CODES
    assert len(flat) == len(set(flat))


def test_tiers_are_cumulative():
    found = buckets()
    running = set()
    cumulative = {}
    for tier in TIER_ORDER:
        running |= found[tier]
        cumulative[tier] = set(running)
    for lower, upper in zip(TIER_ORDER, TIER_ORDER[1:]):
        assert cumulative[lower] < cumulative[upper], f"{upper} must strictly contain {lower}"
    assert cumulative[AccessTier.FULL] == set(LIBRARY_CODES)


def test_tier_contents_follow_blueprint_3_7():
    found = buckets()
    assert found[AccessTier.VIEW] == {c for c in LIBRARY_CODES if c.endswith(".view")}
    assert {"library.console.view", "library.reports.view", "library.settings.view"} <= found[AccessTier.VIEW]
    assert found[AccessTier.OPERATE] == set(LIBRARY_OPERATE_CODES)
    assert found[AccessTier.MANAGE] == set(LIBRARY_MANAGE_CODES)
    assert found[AccessTier.FULL] == {"library.settings.manage"}
    assert "library.visits.check_in" in found[AccessTier.OPERATE]
    assert "library.book_issues.waive_fine" in found[AccessTier.MANAGE]


def test_old_classifier_would_have_put_everything_in_full():
    """The reason for the explicit map: classify() misreads dot-style library codes."""
    assert {classify(code) for code in LIBRARY_CODES if not code.endswith(".view")} == {AccessTier.FULL}


@pytest.mark.parametrize(
    "code", ["fees.fees_group.view", "human_resource.staff.view", "library_legacy_create", "x.add_student", "x.delete_student"]
)
def test_other_modules_keep_the_old_classifier(code):
    module = code.split(".")[0]
    assert module != "library"
    assert classify_for_module(module, code) == classify(code)


def test_seed_commands_store_the_cumulative_library_tiers():
    out = StringIO()
    call_command("seed_permissions", stdout=out)
    call_command("seed_module_tiers", stdout=out)
    sets = {
        tier: set(ModuleAccessTier.objects.get(module="library", tier=tier).permissions.values_list("code", flat=True))
        for tier in TIER_ORDER
    }
    found = buckets()
    assert sets[AccessTier.VIEW] == found[AccessTier.VIEW]
    assert sets[AccessTier.OPERATE] == found[AccessTier.VIEW] | found[AccessTier.OPERATE]
    assert sets[AccessTier.MANAGE] == sets[AccessTier.OPERATE] | found[AccessTier.MANAGE]
    assert sets[AccessTier.FULL] == set(LIBRARY_CODES)
    assert len(sets[AccessTier.VIEW]) > 4  # not the empty/old result for a view tier
