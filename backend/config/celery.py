import os
from celery import Celery
from celery.schedules import crontab

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.production")

app = Celery("school_erp")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

# ── Celery Beat — scheduled tasks ─────────────────────────────────────────
# Defined here (not in settings) so crontab is only imported by the Celery
# worker/beat process, never by daphne/Django at ASGI startup time.
app.conf.beat_schedule = {
    # Run every morning at 8:00 AM (server local time)
    "admissions-morning-followup-digest": {
        "task": "admissions.send_followup_reminders",
        "schedule": crontab(hour=8, minute=0),
    },
    # Recompute lead scores every day at 7:45 AM
    "admissions-compute-lead-scores": {
        "task": "admissions.compute_lead_scores",
        "schedule": crontab(hour=7, minute=45),
    },
    # Library: flag students who have not checked in to a library period (every minute).
    # `manage.py library_register_periodic_tasks` writes the same entry for a DatabaseScheduler.
    "library-flag-unscanned-students": {
        "task": "library.flag_unscanned_students",
        "schedule": 60.0,
    },
}
