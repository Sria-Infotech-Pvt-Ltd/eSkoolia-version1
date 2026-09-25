"""
Custom Exception Handler for Django REST Framework.
Provides standardized error responses across the API.
"""

import logging

from django.db.utils import IntegrityError as DjangoIntegrityError
from django.db.utils import OperationalError as DjangoOperationalError
from django.db.utils import ProgrammingError as DjangoProgrammingError
from django.http import Http404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.exceptions import APIException, ValidationError as DRFValidationError


logger = logging.getLogger(__name__)


def _first_error_message(detail):
    if isinstance(detail, str):
        return detail

    if isinstance(detail, list):
        for item in detail:
            message = _first_error_message(item)
            if message:
                return message
        return None

    if isinstance(detail, dict):
        non_field = detail.get("non_field_errors")
        if non_field:
            message = _first_error_message(non_field)
            if message:
                return message

        for value in detail.values():
            message = _first_error_message(value)
            if message:
                return message

    return None


def custom_exception_handler(exc, context):
    """
    Custom exception handler that returns standardized error responses.
    
    Args:
        exc: The exception that was raised
        context: Context information about the request
    
    Returns:
        Response with standardized error format
    """
    
    # Handle database connection errors (e.g. Neon free-tier auto-suspend)
    if isinstance(exc, DjangoOperationalError):
        logger.warning("Database connection error: %s", exc)
        return Response(
            {
                "success": False,
                "error": {
                    "code": "database_unavailable",
                    "message": "Database is temporarily unavailable. Please try again in a few seconds.",
                },
            },
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    # Handle database schema errors (e.g. unapplied migrations)
    if isinstance(exc, DjangoProgrammingError):
        logger.error(
            "Database schema error (possibly unapplied migration): %s", exc, exc_info=True
        )
        return Response(
            {
                "success": False,
                "error": {
                    "code": "database_schema_error",
                    "message": "A database schema error occurred. Please contact the administrator.",
                },
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    # Handle DB integrity errors (unique constraints, NOT NULL drift, etc.)
    if isinstance(exc, DjangoIntegrityError):
        raw = str(exc).lower()
        if "unique" in raw or "duplicate key" in raw:
            field = "value"
            for candidate in ("username", "email", "phone", "admission_number", "code"):
                if candidate in raw:
                    field = candidate
                    break
            return Response(
                {
                    "success": False,
                    "error": {
                        "code": "already_exists",
                        "message": f"A record with this {field} already exists.",
                        "field": field,
                    },
                },
                status=status.HTTP_409_CONFLICT,
            )
        if "not-null" in raw or "null value" in raw:
            logger.error("NOT NULL integrity error (possible schema drift): %s", exc)
            return Response(
                {
                    "success": False,
                    "error": {
                        "code": "missing_required_field",
                        "message": "A required field is missing. Please contact admin (schema mismatch).",
                    },
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        logger.error("Database integrity error: %s", exc)
        return Response(
            {
                "success": False,
                "error": {
                    "code": "integrity_error",
                    "message": "The request violates a data integrity rule.",
                },
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Handle Http404 (e.g. get_object_or_404 from generics/get_object)
    if isinstance(exc, Http404):
        return Response(
            {
                "success": False,
                "status": status.HTTP_404_NOT_FOUND,
                "error": {
                    "code": "not_found",
                    "message": "The requested record was not found. It may have been deleted — please refresh and try again.",
                },
            },
            status=status.HTTP_404_NOT_FOUND,
        )

    # Return a clean validation message with no nested non_field_errors structure.
    if isinstance(exc, DRFValidationError):
        message = _first_error_message(exc.detail) or "Validation failed"
        field_errors = exc.detail if isinstance(exc.detail, dict) else {"non_field_errors": exc.detail}
        return Response({
            "success": False,
            "status": status.HTTP_400_BAD_REQUEST,
            "error": {
                "code": "validation_error",
                "message": message,
            },
            "field_errors": field_errors,
        }, status=status.HTTP_400_BAD_REQUEST)

    # Handle our custom API exceptions
    if isinstance(exc, APIException):
        if hasattr(exc, 'get_response_data'):
            # Our custom exception with get_response_data method
            return Response(exc.get_response_data(), status=exc.status_code)
        else:
            # Standard DRF exception
            return Response(
                {
                    "success": False,
                    "status": exc.status_code,
                    "error": {
                        "code": getattr(exc, 'default_code', 'error'),
                        "message": str(exc.detail),
                    },
                },
                status=exc.status_code,
            )
    
    # Handle validation errors
    elif isinstance(exc, Exception) and hasattr(exc, 'messages'):
        return Response(
            {
                "success": False,
                "status": status.HTTP_400_BAD_REQUEST,
                "error": {
                    "code": "validation_error",
                    "message": "Validation failed",
                    "details": exc.messages if isinstance(exc.messages, dict) else str(exc.messages),
                },
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    
    # Handle generic exceptions
    else:
        logger.exception("Unhandled exception in API", exc_info=exc)
        return Response(
            {
                "success": False,
                "status": status.HTTP_500_INTERNAL_SERVER_ERROR,
                "error": {
                    "code": "internal_server_error",
                    "message": "An unexpected error occurred",
                },
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
