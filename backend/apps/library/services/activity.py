from apps.library.models import LibraryActivityLog

VALID_EVENT_TYPES = frozenset(value for value, _label in LibraryActivityLog.EVENT_CHOICES)
SUMMARY_MAX_LENGTH = LibraryActivityLog._meta.get_field("summary").max_length
_REF_MODEL_FIELDS = ("book", "copy", "member", "issue")


def log_event(school, actor, event_type, summary, **refs):
    """Append one row to the library activity feed.

    Call it inside the same ``transaction.atomic()`` as the action it records so
    a log row exists if and only if the action committed (blueprint 3.1).

    ``refs`` accepts ``book``, ``copy``, ``member`` and ``issue`` model instances (each must
    belong to ``school``) and ``metadata``, a dict of ids and amounts only. The
    summary may name a member but must never carry a phone, email or address.
    """
    if event_type not in VALID_EVENT_TYPES:
        raise ValueError(f"Unknown library event type: {event_type!r}")
    metadata = refs.pop("metadata", None) or {}
    unknown = set(refs) - set(_REF_MODEL_FIELDS)
    if unknown:
        raise TypeError(f"Unknown activity reference(s): {', '.join(sorted(unknown))}")
    for name, obj in refs.items():
        if obj is not None and obj.school_id != school.id:
            raise ValueError(f"{name} does not belong to the school being logged against")

    return LibraryActivityLog.objects.create(
        school=school,
        actor=actor,
        created_by=actor,
        updated_by=actor,
        event_type=event_type,
        summary=(summary or "")[:SUMMARY_MAX_LENGTH],
        metadata=metadata,
        **refs,
    )
