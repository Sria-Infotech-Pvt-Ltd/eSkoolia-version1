/**
 * Teacher Portal module definitions.
 *
 * Shape matches lib/routes.ts (ModuleRoute) so all shared nav components
 * (ModulePill, SubNav, ModuleGrid, RecentsRow) work without modification.
 *
 * Visibility rule (enforced in lib/portal-modules.ts → getModulesForUser):
 *   • TEACHER_MODULES are ALWAYS shown in full — no permission filtering.
 *     Permissions control what a teacher can DO on a page, not whether
 *     the page appears in the nav.
 *   • Extra admin modules (Fees, HR, Academics, etc.) are appended when the
 *     teacher role has been explicitly granted those permissions via the
 *     Roles & Permissions UI.
 *
 * The `permission` fields below are documentation-only — they record which
 * backend prefix corresponds to each module but are NOT evaluated for nav
 * visibility. They ARE used by TEACHER_FLAT_INDEX for the ⌘K search.
 */

import {
  LayoutGrid,
  Users,
  Calendar,
  CheckSquare,
  BookOpen,
  FileText,
  MessageSquare,
  User,
  ClipboardList,
  Bell,
  Award,
  BookMarked,
} from 'lucide-react';
import type { ModuleRoute } from '@/lib/routes';

export const TEACHER_MODULES: ModuleRoute[] = [
  {
    id: 'teacher-home',
    name: 'Home',
    path: '/teacher/home',
    icon: LayoutGrid,
    bg: '#EEF2FF',
    ic: '#4F46E5',
    sub: [],
  },
  {
    id: 'teacher-classes',
    name: 'My Classes',
    path: '/teacher/classes',
    icon: Users,
    bg: '#FEF3F2',
    ic: '#B42318',
    permission: 'student_info', // backend prefix: student_info.*
    sub: [
      { label: 'Class Overview',    path: '/teacher/classes',           icon: Users },
      { label: 'Student Profiles',  path: '/teacher/classes/students',  icon: User  },
    ],
  },
  {
    id: 'teacher-timetable',
    name: 'Timetable',
    path: '/teacher/timetable',
    icon: Calendar,
    bg: '#ECFDF5',
    ic: '#047857',
    // No permission guard — every teacher always sees their timetable
    sub: [
      { label: 'Weekly View', path: '/teacher/timetable', icon: Calendar },
    ],
  },
  {
    id: 'teacher-attendance',
    name: 'Attendance',
    path: '/teacher/attendance',
    icon: CheckSquare,
    bg: '#FFFBEB',
    ic: '#B45309',
    // No permission guard — core teacher function
    sub: [],
  },
  {
    id: 'teacher-homework',
    name: 'Homework',
    path: '/teacher/homework',
    icon: BookOpen,
    bg: '#F0FDF4',
    ic: '#15803D',
    permission: 'academics', // backend prefix: academics.*
    sub: [
      { label: 'Assignments',  path: '/teacher/homework',             icon: BookOpen      },
      { label: 'Submissions',  path: '/teacher/homework/submissions', icon: ClipboardList },
    ],
  },
  {
    id: 'teacher-lessons',
    name: 'Lessons',
    path: '/teacher/lessons',
    icon: FileText,
    bg: '#FDF4FF',
    ic: '#A21CAF',
    permission: 'academics', // backend prefix: academics.*
    sub: [
      { label: 'Lesson Plans', path: '/teacher/lessons', icon: FileText },
    ],
  },
  {
    id: 'teacher-messages',
    name: 'Messages',
    path: '/teacher/messages',
    icon: MessageSquare,
    bg: '#F0F9FF',
    ic: '#0369A1',
    permission: 'utilities', // backend prefix: utilities.*
    sub: [
      { label: 'Parent Messages', path: '/teacher/messages', icon: MessageSquare },
    ],
  },
  {
    id: 'teacher-exams',
    name: 'Exams',
    path: '/teacher/exams',
    icon: Award,
    bg: '#EEF2FF',
    ic: '#4F46E5',
    permission: 'academics', // backend prefix: academics.* or exams.*
    sub: [
      { label: 'Marks Entry', path: '/teacher/exams', icon: ClipboardList },
    ],
  },
  {
    id: 'teacher-library',
    name: 'Library',
    path: '/teacher/library',
    icon: BookMarked,
    bg: 'var(--pu-soft)',
    ic: 'var(--pu-deep)',
    // No permission guard — every teacher sees all three pages. Access is scoped server-side
    // (class-teacher scope for My Class, the teacher's own member record for My Books).
    sub: [
      { label: 'My Class',  path: '/teacher/library',           icon: Users },
      { label: 'My Books',  path: '/teacher/library/my-books',  icon: BookOpen },
      { label: 'Recommend', path: '/teacher/library/recommend', icon: ClipboardList },
    ],
  },
  {
    id: 'teacher-notices',
    name: 'Notices',
    path: '/teacher/notices',
    icon: Bell,
    bg: '#FFFBEB',
    ic: '#B45309',
    // No permission guard — every teacher can always see school notices,
    // same as the parent and student portals.
    sub: [
      { label: 'School Notices', path: '/teacher/notices', icon: Bell },
    ],
  },
  {
    id: 'teacher-profile',
    name: 'My Profile',
    path: '/teacher/profile',
    icon: User,
    bg: '#F5F3FF',
    ic: '#6D28D9',
    // No permission guard — every teacher can always see their own profile,
    // self-scoped server-side via /api/v1/hr/staff/me/.
    sub: [],
  },
];

/**
 * Flat index for ⌘K search and RecentsRow breadcrumbs.
 * Includes every module + sub-page with its icon, colors, and permission prefix.
 */
export const TEACHER_FLAT_INDEX = TEACHER_MODULES.flatMap((m) => [
  { modId: m.id, label: m.name, path: m.path, icon: m.icon, bg: m.bg, ic: m.ic, permission: m.permission },
  ...m.sub.map((s) => ({
    modId: m.id,
    label: s.label,
    path: s.path,
    icon: s.icon ?? m.icon,
    bg: m.bg,
    ic: m.ic,
    permission: s.permission ?? m.permission,
  })),
]);
