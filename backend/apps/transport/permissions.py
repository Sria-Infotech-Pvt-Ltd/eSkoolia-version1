"""
Transport permission codes.

Follows the project's `<module>.<feature>.<action>` convention (see
apps/access_control/management/commands/seed_permissions.py) and plugs into
apps.core.views.PermissionScopedViewSet, which looks up `permission_codes[action]`
and falls back to `permission_codes["*"]`.

Before Phase 1 every Transport endpoint used only a `.view` code for all actions,
so read-only roles could create, edit and delete. Writes now need add/edit/delete
codes; migration access_control/0017 grants them to every role that already held
the matching view code, so no existing role loses what it could do.
"""

TRACKING_UPDATE = "transport.tracking.update"  # push GPS positions (devices / driver apps)


def crud_codes(feature, edit_actions=(), delete_actions=()):
    """
    Map DRF actions to transport.<feature>.view/add/edit/delete.

    Unlisted actions (list, retrieve and custom read actions) require `.view`.
    Custom actions that change data must be passed in `edit_actions` /
    `delete_actions`, otherwise they would only need the view code.
    """
    base = f"transport.{feature}"
    codes = {
        "*": f"{base}.view",
        "create": f"{base}.add",
        "update": f"{base}.edit",
        "partial_update": f"{base}.edit",
        "destroy": f"{base}.delete",
    }
    for action_name in edit_actions:
        codes[action_name] = f"{base}.edit"
    for action_name in delete_actions:
        codes[action_name] = f"{base}.delete"
    return codes


# Codes introduced in Phase 1 -> the existing view code whose holders receive them.
NEW_WRITE_CODES = {
    "transport.vehicle.add": "transport.vehicle.view",
    "transport.vehicle.edit": "transport.vehicle.view",
    "transport.vehicle.delete": "transport.vehicle.view",
    "transport.route.add": "transport.route.view",
    "transport.route.edit": "transport.route.view",
    "transport.route.delete": "transport.route.view",
    "transport.assign_vehicle.add": "transport.assign_vehicle.view",
    "transport.assign_vehicle.edit": "transport.assign_vehicle.view",
    "transport.assign_vehicle.delete": "transport.assign_vehicle.view",
    TRACKING_UPDATE: "transport.vehicle.view",
}


# Codes introduced in Phase 2 (drivers/attendants, student allocation, boarding
# register, alerts). Alerts previously used transport.vehicle.* codes; every code
# below is granted by migration access_control/0018 to roles holding
# transport.vehicle.view, so nobody loses access they had.
PHASE2_FEATURES = ["staff", "allocation", "attendance", "alert"]
PHASE2_CODES = {
    f"transport.{feature}.{action_name}": "transport.vehicle.view"
    for feature in PHASE2_FEATURES
    for action_name in ("view", "add", "edit", "delete")
}


# Codes introduced in Phase 3 (maintenance, fuel, dashboard summary, reports).
# Granted by migration access_control/0019 to roles holding transport.vehicle.view.
DASHBOARD_VIEW = "transport.dashboard.view"
REPORT_VIEW = "transport.report.view"
PHASE3_CODES = {
    **{
        f"transport.{feature}.{action_name}": "transport.vehicle.view"
        for feature in ("maintenance", "fuel")
        for action_name in ("view", "add", "edit", "delete")
    },
    DASHBOARD_VIEW: "transport.vehicle.view",
    REPORT_VIEW: "transport.vehicle.view",
}


# Codes introduced in Phase 4 (Transport Settings). Granted by migration
# access_control/0020 to roles holding transport.vehicle.view.
SETTINGS_VIEW = "transport.settings.view"
SETTINGS_EDIT = "transport.settings.edit"
PHASE4_CODES = {SETTINGS_VIEW: "transport.vehicle.view", SETTINGS_EDIT: "transport.vehicle.view"}
