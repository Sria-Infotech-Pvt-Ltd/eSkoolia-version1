import {
  LayoutGrid, Users, CalendarDays, CreditCard, Bell, GraduationCap,
  BookOpen, FileText, Star, Leaf, Shield, MessageCircle, Trophy,
  Bus, Activity, User,
} from "lucide-react";
import type { ModuleRoute } from "@/lib/routes";

/**
 * Parent portal module definitions.
 *
 * Visibility rule (enforced in lib/portal-modules.ts → getModulesForUser):
 *   • PARENT_MODULES are ALWAYS shown in full — no permission filtering.
 *     Every parent always sees all parent pages (Attendance, Fees, Results
 *     etc.). Permissions control data access on the backend, not nav visibility.
 *   • Parent portal never receives extra admin modules — it is consumer-facing.
 *     Only the teacher portal can have admin-granted extras appended.
 *
 * The `permission` fields are documentation-only — they record the backend
 * prefix but are not evaluated for nav visibility in the parent portal.
 */
export const PARENT_MODULES: ModuleRoute[] = [
  {
    id: "parent-home",
    name: "Home",
    path: "/parent/home",
    icon: LayoutGrid,
    bg: "var(--pu-soft)",
    ic: "var(--pu-deep)",
    // Always visible — no permission guard
    sub: [],
  },
  {
    id: "parent-academics",
    name: "Academics",
    path: "/parent/children",
    icon: GraduationCap,
    bg: "var(--ok-soft)",
    ic: "#0d7a55",
    permission: "academics",
    sub: [
      { label: "Timetable",  path: "/parent/timetable", icon: CalendarDays },
      { label: "Syllabus",   path: "/parent/syllabus",  icon: BookOpen     },
      { label: "Homework",   path: "/parent/homework",  icon: FileText     },
      { label: "Grades",     path: "/parent/results",   icon: Star         },
      { label: "Library",    path: "/parent/library",   icon: BookOpen     },
      { label: "Library History", path: "/parent/library/history", icon: FileText },
    ],
  },
  {
    id: "parent-attendance",
    name: "Attendance",
    path: "/parent/attendance",
    icon: CalendarDays,
    bg: "var(--ok-soft)",
    ic: "#0d7a55",
    permission: "attendance",
    sub: [
      { label: "Daily Log",    path: "/parent/attendance", icon: CalendarDays },
      { label: "Apply Leave",  path: "/parent/attendance", icon: Leaf         },
      { label: "Calendar",     path: "/parent/attendance", icon: CalendarDays },
      { label: "Holidays",     path: "/parent/attendance", icon: Shield       },
    ],
  },
  {
    id: "parent-fees",
    name: "Fees",
    path: "/parent/fees",
    icon: CreditCard,
    bg: "var(--warn-soft)",
    ic: "var(--warn)",
    permission: "fees",
    sub: [
      { label: "Fee Summary",  path: "/parent/fees", icon: CreditCard },
      { label: "Receipts",     path: "/parent/fees", icon: FileText   },
    ],
  },
  {
    id: "parent-communication",
    name: "Communication",
    path: "/parent/notices",
    icon: Bell,
    bg: "var(--info-soft)",
    ic: "var(--info)",
    // Always visible — communication is a core parent feature
    sub: [
      { label: "Notices",      path: "/parent/notices",  icon: Bell          },
      { label: "Messages",     path: "/parent/messages", icon: MessageCircle },
      { label: "PTMs",         path: "/parent/notices",  icon: Users         },
      { label: "Permissions",  path: "/parent/notices",  icon: FileText      },
    ],
  },
  {
    id: "parent-results",
    name: "Results",
    path: "/parent/results",
    icon: Trophy,
    bg: "var(--pu-soft)",
    ic: "var(--pu-deep)",
    permission: "examination",
    sub: [
      { label: "Exam Results",   path: "/parent/results",             icon: Trophy   },
      { label: "Report Cards",   path: "/parent/results/report-card", icon: FileText },
    ],
  },
  {
    id: "parent-student-life",
    name: "Student Life",
    path: "/parent/children",
    icon: Activity,
    bg: "#E0EAFE",
    ic: "#0369A1",
    // No hard permission — schools generally always show this
    sub: [
      { label: "Behaviour",      path: "/parent/behaviour", icon: Star     },
      { label: "Health Log",     path: "/parent/health",    icon: Activity },
      { label: "Sports & Clubs", path: "/parent/children",  icon: Trophy   },
    ],
  },
  {
    id: "parent-profile",
    name: "My Profile",
    path: "/parent/profile",
    icon: User,
    bg: "var(--pu-soft)",
    ic: "var(--pu-deep)",
    // Always visible — every parent can see their own children's onboarding
    // data, self-scoped server-side via Guardian.user.
    sub: [],
  },
  {
    id: "parent-transport",
    name: "Transport",
    path: "/parent/home",
    icon: Bus,
    bg: "#FCE6F0",
    ic: "#992558",
    permission: "transport",
    sub: [
      { label: "Bus Tracking", path: "/parent/home",     icon: Bus   },
      { label: "Pickup Auth",  path: "/parent/children", icon: Users },
    ],
  },
];

// getVisibleParentModules() was removed — use useVisibleModules() from
// hooks/useVisibleModules.ts which calls getModulesForUser() centrally.
