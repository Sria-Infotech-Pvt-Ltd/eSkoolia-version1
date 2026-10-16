from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from apps.access_control.permission_classes import IsSchoolAdminOrSuperuser
from .ai import ReviewItem, get_or_generate_review
from .models import AIRequestLog, Competition, Result
from .serializers import (
    AIRequestLogSerializer,
    AIReviewBatchSerializer,
    AIReviewResponseSerializer,
    CompetitionSerializer,
    ResultSerializer,
)


class CompetitionViewSet(viewsets.ModelViewSet):
    queryset = Competition.objects.all().prefetch_related("teams", "results")
    serializer_class = CompetitionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        return qs.filter(school_id=user.school_id)

    def perform_create(self, serializer):
        user = self.request.user if self.request.user.is_authenticated else None
        school = getattr(user, "school", None) if user else None
        serializer.save(created_by=user, school=school)


class ResultViewSet(viewsets.ModelViewSet):
    queryset = Result.objects.all().select_related("competition", "student", "team", "house", "club")
    serializer_class = ResultSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        return qs.filter(competition__school_id=user.school_id)

    def get_serializer(self, *args, **kwargs):
        if isinstance(kwargs.get("data"), list):
            kwargs["many"] = True
        return super().get_serializer(*args, **kwargs)

    @action(detail=False, methods=["post"], url_path="bulk")
    def bulk_create(self, request):
        serializer = self.get_serializer(data=request.data, many=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class AIReviewThrottle(UserRateThrottle):
    scope = "ai_review"
    rate = "60/min"


class AIReviewView(APIView):
    """POST a batch of up to 50 review items, returns AI-generated reviews."""

    permission_classes = [IsAdminUser]
    throttle_classes = [AIReviewThrottle]

    def post(self, request, *args, **kwargs):
        serializer = AIReviewBatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        items = serializer.validated_data["items"]

        results = []
        for raw in items:
            item = ReviewItem.from_validated(raw)
            data = get_or_generate_review(item, user=request.user)
            results.append({
                "student_id": item.student_id,
                "competition_id": item.competition_id,
                "position": item.position,
                "review": data["review"],
                "prompt_hash": data["prompt_hash"],
                "cache_hit": data["cache_hit"],
                "fallback": data["fallback"],
            })

        out = AIReviewResponseSerializer({"results": results})
        return Response(out.data, status=status.HTTP_200_OK)


class AIRequestLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AIRequestLog.objects.all()
    serializer_class = AIRequestLogSerializer
    permission_classes = [IsSchoolAdminOrSuperuser]

    def get_queryset(self):
        # Scoped like any other per-school page — including for superusers,
        # who are provisioned with their own school (see CLAUDE.md tenancy policy).
        qs = super().get_queryset()
        return qs.filter(user__school_id=self.request.user.school_id)
