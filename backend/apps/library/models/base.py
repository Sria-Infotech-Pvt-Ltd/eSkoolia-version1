from django.db import models


class LibraryAuditModel(models.Model):
    """created_by / updated_by on every library table (blueprint 2.1).

    The "+" related names keep the reverse side off the User model; the audit
    columns are only ever read forwards.
    """

    created_by = models.ForeignKey(
        "users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    updated_by = models.ForeignKey(
        "users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        abstract = True
