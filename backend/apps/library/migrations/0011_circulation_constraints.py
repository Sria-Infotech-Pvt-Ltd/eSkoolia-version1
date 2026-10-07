"""One open loan per copy, and date sanity on loans. Added after 0010 bound the loans and checked the dates."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('library', '0010_circulation_backfill'),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='bookissue',
            constraint=models.UniqueConstraint(condition=models.Q(('copy__isnull', False), ('status', 'issued')), fields=('copy',), name='uq_library_book_issues_open_copy'),
        ),
        migrations.AddConstraint(
            model_name='bookissue',
            constraint=models.CheckConstraint(condition=models.Q(('due_date__gte', models.F('issue_date'))), name='ck_library_book_issues_due_after_issue'),
        ),
        migrations.AddConstraint(
            model_name='bookissue',
            constraint=models.CheckConstraint(condition=models.Q(('return_date__isnull', True), ('return_date__gte', models.F('issue_date')), _connector='OR'), name='ck_library_book_issues_return_after_issue'),
        ),
    ]
