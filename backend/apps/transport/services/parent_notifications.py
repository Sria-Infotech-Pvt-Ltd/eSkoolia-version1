import os
from typing import Optional

import requests


def send_sms_twilio(to_phone: str, message: str) -> tuple[str, str, str]:
    account_sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    auth_token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
    from_phone = os.getenv("TWILIO_FROM_NUMBER", "").strip()

    if not account_sid or not auth_token or not from_phone:
        return ("skipped", "twilio", "Twilio credentials not configured")

    try:
        response = requests.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json",
            data={"From": from_phone, "To": to_phone, "Body": message},
            auth=(account_sid, auth_token),
            timeout=10,
        )
        if 200 <= response.status_code < 300:
            return ("sent", "twilio", "")
        return ("failed", "twilio", f"HTTP {response.status_code}: {response.text[:300]}")
    except Exception as exc:  # pragma: no cover
        return ("failed", "twilio", str(exc))


def send_email_sendgrid(to_email: str, subject: str, message: str) -> tuple[str, str, str]:
    api_key = os.getenv("SENDGRID_API_KEY", "").strip()
    from_email = os.getenv("SENDGRID_FROM_EMAIL", "").strip()

    if not api_key or not from_email:
        return ("skipped", "sendgrid", "SendGrid credentials not configured")

    try:
        response = requests.post(
            "https://api.sendgrid.com/v3/mail/send",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "personalizations": [{"to": [{"email": to_email}]}],
                "from": {"email": from_email},
                "subject": subject,
                "content": [{"type": "text/plain", "value": message}],
            },
            timeout=10,
        )
        if 200 <= response.status_code < 300:
            return ("sent", "sendgrid", "")
        return ("failed", "sendgrid", f"HTTP {response.status_code}: {response.text[:300]}")
    except Exception as exc:  # pragma: no cover
        return ("failed", "sendgrid", str(exc))


def safe_guardian_phone(raw_phone: Optional[str]) -> str:
    phone = (raw_phone or "").strip()
    if not phone:
        return ""
    return phone


def notify_guardians(vehicle, students, message, subject):
    """
    SMS + email each student's guardian and log every attempt in
    TransportNotificationLog. Uses the existing Twilio/SendGrid senders above,
    which return "skipped" (never raise) when credentials aren't configured.
    Returns the number of log rows written.
    """
    from apps.transport.models import TransportNotificationLog

    written = 0
    for student in students:
        guardian = getattr(student, "guardian", None)
        if not guardian:
            continue

        phone = safe_guardian_phone(getattr(guardian, "phone", ""))
        email = (getattr(guardian, "email", "") or "").strip()

        if phone:
            sms_status, sms_provider, sms_error = send_sms_twilio(phone, message)
            TransportNotificationLog.objects.create(
                vehicle=vehicle, student=student, channel="sms", provider=sms_provider,
                recipient=phone, message=message, status=sms_status, error_message=sms_error,
            )
            written += 1

        if email:
            email_status, email_provider, email_error = send_email_sendgrid(email, subject, message)
            TransportNotificationLog.objects.create(
                vehicle=vehicle, student=student, channel="email", provider=email_provider,
                recipient=email, message=message, status=email_status, error_message=email_error,
            )
            written += 1
    return written
