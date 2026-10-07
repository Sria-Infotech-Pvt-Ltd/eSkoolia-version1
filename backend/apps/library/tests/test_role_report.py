"""library_role_report is read-only and names roles that lost accidental write access (D12)."""
from io import StringIO

from django.core.management import call_command

from apps.access_control.models import Role, RolePermission
from apps.library.tests.conftest import make_user


def run(*args):
    out = StringIO()
    call_command("library_role_report", *args, stdout=out)
    return out.getvalue()


def test_reports_reader_roles_and_what_they_lost(school):
    make_user(school, ["library.books.view", "library.book_issues.view"])
    text = run()
    assert "library.books.view" in text
    assert "no longer able to" in text
    for code in ("library.books.create", "library.books.update", "library.books.delete", "library.book_issues.issue", "library.book_issues.return"):
        assert code in text
    assert "Nothing was changed" in text


def test_role_with_matching_write_codes_loses_nothing(school):
    make_user(school, ["library.book_categories.view", "library.book_categories.create", "library.book_categories.update", "library.book_categories.delete"])
    assert "no loss of access" in run()


def test_roles_without_library_view_codes_are_ignored(school):
    make_user(school, ["fees.fees_group.view", "library.books.create"])
    assert "No role holds a library view code." in run()


def test_school_filter(school, other_school):
    make_user(school, ["library.books.view"])
    make_user(other_school, ["library.books.view"])
    assert "(all schools)" not in run("--school", str(school.id))
    assert run("--school", str(school.id)).count("- role #") == 1


def test_command_changes_nothing(school):
    make_user(school, ["library.books.view"])
    before = (Role.objects.count(), RolePermission.objects.count())
    run()
    assert (Role.objects.count(), RolePermission.objects.count()) == before
