"""Migration C-lite: unique constraints that need the 0004 backfill to have filled the codes first."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('library', '0004_catalogue_backfill'),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='book',
            constraint=models.UniqueConstraint(fields=('school', 'accession_code'), name='uq_library_books_school_accession'),
        ),
        migrations.AddConstraint(
            model_name='bookcategory',
            constraint=models.UniqueConstraint(fields=('school', 'code'), name='uq_library_book_categories_school_code'),
        ),
    ]
