"""
Management command: python manage.py library_role_report [--school ID]

READ-ONLY. Lists the roles that hold any library ".view" permission.

Before the library permission split (decision D12) the ".view" codes also
guarded create, update and delete on the four library resources, so every one
of these roles could write. After the split they can only read unless the role
also holds the new write codes. This report shows, per role, which writes it
used to have and no longer has, so an administrator can review the roles and
grant the new codes where the write access was intended.

No data is changed. Only role names, ids and user counts are printed.
"""
from django.core.management.base import BaseCommand

from apps.access_control.models import Role

# A ".view" code that used to guard writes -> the codes that guard them now.
FORMER_WRITE_CODES = {
    "library.book_categories.view": ["library.book_categories.create", "library.book_categories.update", "library.book_categories.delete"],
    "library.books.view": ["library.books.create", "library.books.update", "library.books.delete"],
    "library.library_members.view": ["library.library_members.create", "library.library_members.update", "library.library_members.delete"],
    "library.book_issues.view": ["library.book_issues.issue", "library.book_issues.return"],
}


class Command(BaseCommand):
    help = "Read-only: list roles with library view codes that previously could also write (D12)."

    def add_arguments(self, parser):
        parser.add_argument("--school", type=int, help="Only report roles of this school id.")

    def handle(self, *args, **options):
        roles = (
            Role.objects.filter(permissions__code__startswith="library.", permissions__code__endswith=".view")
            .select_related("school")
            .prefetch_related("permissions")
            .distinct()
            .order_by("school_id", "name")
        )
        if options.get("school"):
            roles = roles.filter(school_id=options["school"])

        rows = list(roles)
        if not rows:
            self.stdout.write("No role holds a library view code.")
            return

        self.stdout.write(
            "Roles holding a library view code. Before the permission split these roles could also "
            "create, update and delete library records; they can now only read unless listed under "
            '"no longer able to".\n'
        )
        for role in rows:
            held = {p.code for p in role.permissions.all() if p.code.startswith("library.")}
            lost = []
            for view_code, write_codes in FORMER_WRITE_CODES.items():
                if view_code in held:
                    lost.extend(code for code in write_codes if code not in held)
            school = role.school.name if role.school_id else "(all schools)"
            self.stdout.write(
                f"- role #{role.id} {role.name!r} | school: {school} | active: {role.is_active} | "
                f"users: {role.user_roles.count()}"
            )
            self.stdout.write(f"    library codes held: {', '.join(sorted(held))}")
            if lost:
                self.stdout.write(f"    no longer able to: {', '.join(lost)}")
            else:
                self.stdout.write("    no loss of access (already holds the matching write codes)")
        self.stdout.write(f"\n{len(rows)} role(s) reviewed. Nothing was changed.")
