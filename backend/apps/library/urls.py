from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    BookCategoryViewSet,
    BookCopyViewSet,
    BookIssueViewSet,
    BookViewSet,
    ChargeViewSet,
    ConsoleSummaryView,
    HoldViewSet,
    LibraryMemberViewSet,
    LibrarySettingsView,
    LostDamagedViewSet,
)

router = DefaultRouter()
router.register("categories", BookCategoryViewSet, basename="library-category")
router.register("books", BookViewSet, basename="library-book")
router.register("copies", BookCopyViewSet, basename="library-copy")
router.register("members", LibraryMemberViewSet, basename="library-member")
router.register("charges", ChargeViewSet, basename="library-charge")
router.register("issues", BookIssueViewSet, basename="library-issue")
router.register("holds", HoldViewSet, basename="library-hold")
router.register("lost-damaged", LostDamagedViewSet, basename="library-lost-damaged")

urlpatterns = [
    path("settings/", LibrarySettingsView.as_view(), name="library-settings"),
    path("console/summary/", ConsoleSummaryView.as_view(), name="library-console-summary"),
    *router.urls,
]
