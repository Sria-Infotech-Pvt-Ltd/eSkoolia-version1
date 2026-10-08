from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    CheckInView,
    FootfallView,
    OccupancyView,
    PeriodSlotViewSet,
    StockAuditViewSet,
    AcquisitionsSummaryView,
    BookRequestViewSet,
    BudgetView,
    DonationViewSet,
    PurchaseOrderViewSet,
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
router.register("period-slots", PeriodSlotViewSet, basename="library-period-slot")
router.register("stock-audits", StockAuditViewSet, basename="library-stock-audit")
router.register("purchase-orders", PurchaseOrderViewSet, basename="library-purchase-order")
router.register("donations", DonationViewSet, basename="library-donation")
router.register("book-requests", BookRequestViewSet, basename="library-book-request")

urlpatterns = [
    path("settings/", LibrarySettingsView.as_view(), name="library-settings"),
    path("console/summary/", ConsoleSummaryView.as_view(), name="library-console-summary"),
    path("visits/check-in/", CheckInView.as_view(), name="library-visit-check-in"),
    path("visits/occupancy/", OccupancyView.as_view(), name="library-visit-occupancy"),
    path("visits/footfall/", FootfallView.as_view(), name="library-visit-footfall"),
    path("budgets/", BudgetView.as_view(), name="library-budget"),
    path("acquisitions/summary/", AcquisitionsSummaryView.as_view(), name="library-acquisitions-summary"),
    *router.urls,
]
