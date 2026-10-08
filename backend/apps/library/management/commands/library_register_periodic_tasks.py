"""Create the library's periodic task in django_celery_beat (idempotent).

    python manage.py library_register_periodic_tasks

Writes one every-minute entry that runs `library.flag_unscanned_students`. Running it again updates the
same row, so it never makes a duplicate. It needs the `django_celery_beat` app to be installed and
migrated (the DatabaseScheduler). `config/celery.py` also declares the same entry under the same name
for the default scheduler, so nothing runs twice.
"""
from django.apps import apps
from django.core.management.base import BaseCommand, CommandError

from apps.library.tasks import FLAG_TASK_NAME

ENTRY_NAME = "library-flag-unscanned-students"


def beat_models():
    """(IntervalSchedule, PeriodicTask), or a CommandError when django_celery_beat is not installed."""
    if not apps.is_installed("django_celery_beat"):
        raise CommandError(
            "django_celery_beat is not in INSTALLED_APPS, so there is no database schedule to write to. "
            "The same every-minute entry is declared in config/celery.py for the default beat scheduler."
        )
    from django_celery_beat.models import IntervalSchedule, PeriodicTask

    return IntervalSchedule, PeriodicTask


class Command(BaseCommand):
    help = "Create or update the every-minute library_flag_unscanned_students periodic task."

    def handle(self, *args, **options):
        IntervalSchedule, PeriodicTask = beat_models()
        schedule, _ = IntervalSchedule.objects.get_or_create(every=1, period=IntervalSchedule.MINUTES)
        _task, created = PeriodicTask.objects.update_or_create(
            name=ENTRY_NAME,
            defaults={
                "task": FLAG_TASK_NAME,
                "interval": schedule,
                "enabled": True,
                "description": "Flag students who have not checked in to a library period.",
            },
        )
        self.stdout.write(self.style.SUCCESS(f"{'Created' if created else 'Updated'} periodic task {ENTRY_NAME}."))
