"""One membership per student and per staff member, and the type-matches-person rule.

Added after 0007 has proved no existing row breaks them.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('library', '0007_members_data'),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='librarymember',
            constraint=models.UniqueConstraint(condition=models.Q(('student__isnull', False)), fields=('school', 'student'), name='uq_library_members_school_student'),
        ),
        migrations.AddConstraint(
            model_name='librarymember',
            constraint=models.UniqueConstraint(condition=models.Q(('staff__isnull', False)), fields=('school', 'staff'), name='uq_library_members_school_staff'),
        ),
        migrations.AddConstraint(
            model_name='librarymember',
            constraint=models.CheckConstraint(condition=models.Q(models.Q(('member_type', 'student'), ('staff__isnull', True), ('student__isnull', False)), models.Q(('member_type__in', ['teacher', 'staff']), ('staff__isnull', False), ('student__isnull', True)), _connector='OR'), name='ck_library_members_type_matches_person'),
        ),
    ]
