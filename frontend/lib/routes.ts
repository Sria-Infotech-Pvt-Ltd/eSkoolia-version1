import {
  LayoutGrid,
  Users,
  GraduationCap,
  UserCheck,
  ClipboardList,
  HandCoins,
  Landmark,
  UserCog,
  BookOpen,
  Bus,
  Package,
  AlertTriangle,
  UserPlus,
  Briefcase,
  Settings,
  BarChart2,
  MessageCircle,
  BookMarked,
  Calendar,
  School,
  DollarSign,
  AlertCircle,
  CreditCard,
  ChartBar,
  BanknoteIcon,
  ArrowRightLeft,
  Building2,
  ClipboardCheck,
  FileText,
  FileBadge,
  FileBarChart,
  ShieldCheck,
  LogIn,
  BookOpenCheck,
  BookmarkCheck,
  UserSearch,
  MapPin,
  Truck,
  Palette,
  Route,
  Car,
  Store,
  FlagTriangleRight,
  MessageSquare,
  Mail,
  Phone,
  Send,
  BadgeCheck,
  Award,
  ShieldAlert,
  Globe,
  Star,
  LayoutDashboard,
  List,
  Navigation,
  UserX,
  type LucideIcon,
} from 'lucide-react';

export interface SubRoute {
  label: string;
  path: string;
  icon?: LucideIcon;
  permission?: string;
}

export interface ModuleRoute {
  id: string;
  name: string;
  path: string;
  icon: LucideIcon;
  bg: string;
  ic: string;
  sub: SubRoute[];
  permission?: string;
  /** If true, only shown to users with is_superuser=true */
  superuserOnly?: boolean;
  /** If true, hides the module label and tab icons in ModuleSubNav for a clean tab-only look */
  cleanTabs?: boolean;
}

export const MODULES: ModuleRoute[] = [
  {
    id: 'dashboard',
    name: 'Dashboard',
    path: '/dashboard',
    icon: LayoutGrid,
    bg: '#EEF2FF',
    ic: '#4F46E5',
    sub: [],
  },
  // ─── Super Admin (superuser only) ────────────────────────────────────────
  {
    id: 'super_admin',
    name: 'School Tenancy',
    path: '/super-admin/dashboard',
    icon: Building2,
    bg: '#EDE9FE',
    ic: '#6D28D9',
    superuserOnly: true,
    sub: [
      { label: 'Dashboard',   path: '/super-admin/dashboard', icon: LayoutGrid  },
      { label: 'Schools',     path: '/super-admin/schools',   icon: Building2   },
      { label: 'Billing',     path: '/super-admin/billing',   icon: CreditCard  },
      { label: 'Audit Log',   path: '/super-admin/audit',     icon: FileText    },
      { label: 'Policies',    path: '/super-admin/policies',  icon: Settings    },
    ],
  },
  {
    id: 'roles',
    name: 'Roles & Permissions',
    path: '/roles',
    icon: ShieldCheck,
    bg: '#F5F3FF',
    ic: '#6D28D9',
    permission: 'access_control',
    sub: [
      // "Assign Permissions" used to be a separate nav entry here, but its
      // target page requires ?roleId=<id> (see roles/assign-permission/page.tsx)
      // which no nav link can supply - it's only reachable meaningfully from
      // inside a specific role's card on this Roles page. A standalone entry
      // pointing at /roles was tried, but that made it an exact duplicate of
      // this "Roles" entry (same path), which breaks React's list key and
      // permanently mis-highlights "Roles" as active instead. Removed - the
      // Roles page itself is the correct entry point for assigning permissions.
      { label: 'Roles', path: '/roles', icon: ShieldCheck, permission: 'access_control.assign_permission.view' },
      { label: 'Login Permission', path: '/roles/login-permission', icon: LogIn, permission: 'access_control.due_fees_login_permission.view' },
    ],
  },
  {
    id: 'admin',
    name: 'Administration',
    path: '/administration/communication-hub',
    icon: Briefcase,
    bg: '#FDF4FF',
    ic: '#A21CAF',
    permission: 'admin_section',
    sub: [
      { label: 'Communication Hub', path: '/administration/communication-hub', icon: UserSearch },
      { label: 'Postal Management',  path: '/administration/postal',            icon: Mail       },
      { label: 'Documents Studio',   path: '/administration/documents',          icon: FileBadge  },
      { label: 'System Config',      path: '/administration/system-config',      icon: Settings   },
    ],
  },
  {
    id: 'admissions',
    name: 'Admissions',
    path: '/admissions/command-center',
    icon: UserPlus,
    bg: '#ECFDF5',
    ic: '#047857',
    permission: 'admissions',
    sub: [
      { label: 'Command Center', path: '/admissions/command-center', icon: LayoutGrid },
      { label: 'Analytics', path: '/admissions/analytics', icon: BarChart2 },
      { label: 'Marketing', path: '/admissions/marketing', icon: Send },
    ],
  },
  {
    id: 'students',
    name: 'Students',
    path: '/students/list',
    icon: Users,
    bg: '#FEF3F2',
    ic: '#B42318',
    permission: 'student_info',
    sub: [
      { label: 'Student Enroll & List', path: '/students/list', icon: Users, permission: 'student_info.student_list.view' },
      { label: 'Multi Subject Assignment', path: '/students/multi-class', icon: GraduationCap, permission: 'student_info.multi_class_student.view' },
      { label: 'Student Group', path: '/student-groups', icon: UserCheck, permission: 'student_info.student_group.view' },
      { label: 'Student Promote', path: '/students/promote', icon: Star, permission: 'student_info.student_promote.view' },
    ],
  },
  {
    id: 'attendance',
    name: 'Attendance',
    path: '/attendance/student',
    icon: UserCheck,
    bg: '#FFFBEB',
    ic: '#B45309',
    permission: 'attendance',
    sub: [
      { label: 'Student Attendance', path: '/attendance/student', icon: UserCheck, permission: 'student_info.student_attendance.view' },
    ],
  },
  {
    id: 'academics',
    name: 'Academics',
    path: '/academics/core-setup',
    icon: GraduationCap,
    bg: '#F0FDF4',
    ic: '#15803D',
    permission: 'academics',
    sub: [
      // ── Workspace tabs (primary navigation) ─────────────────────────────
      { label: 'Foundation',      path: '/academics/core-setup',         icon: LayoutGrid,   permission: 'academics.core_setup.view' },
      { label: 'Staff Assignment', path: '/academics/staff-workspace',    icon: Users,        permission: 'academics' },
      { label: 'Timetable',       path: '/academics/timetable',          icon: Calendar,     permission: 'academics' },
      { label: 'Planning Studio', path: '/academics/planning-studio',    icon: BookOpen,     permission: 'academics' },
      { label: 'Reports',         path: '/academics/academic-reports',   icon: FileBarChart, permission: 'academics' },

      // HIDDEN - replaced with workspace navigation
      // { label: 'Core Setup',            path: '/academics/core-setup',                 icon: Settings,       permission: 'academics.core_setup.view' },
      // { label: 'Assign Class Teacher',  path: '/academics/assign-class-teacher',       icon: UserCog,        permission: 'academics.assign_class_teacher.view' },
      // { label: 'Assign Subject',        path: '/academics/assign-subject',             icon: ClipboardList,  permission: 'academics.assign_subject.view' },
      // { label: 'Class Room',            path: '/academics/class-room',                 icon: School,         permission: 'academics.class_room.view' },
      // { label: 'Class Routine',         path: '/academics/class-routine',              icon: Calendar,       permission: 'academics.class_routine.view' },
      // { label: 'Lessons',               path: '/academics/lessons',                    icon: BookOpen,       permission: 'academics.lesson.view' },
      // { label: 'Topics',                path: '/academics/topics',                     icon: BookOpenCheck,  permission: 'academics.topic.view' },
      // { label: 'Lesson Planner',        path: '/academics/lesson-planner',             icon: ClipboardCheck, permission: 'academics.lesson_planner.view' },
      // { label: 'Homework Add',          path: '/academics/homework-add',               icon: FileText,       permission: 'academics.add_homework.view' },
      // { label: 'Homework List',         path: '/academics/homework-list',              icon: ClipboardList,  permission: 'academics.homework_list.view' },
      // { label: 'Homework Evaluation',   path: '/academics/homework-evaluation-report', icon: FileBarChart,   permission: 'academics.homework_evaluation_report.view' },
      // { label: 'Upload Content',        path: '/academics/upload-content',             icon: Send,           permission: 'academics.upload_content.view' },
      // { label: 'Assignment List',       path: '/academics/assignment-list',            icon: ClipboardCheck, permission: 'academics.assignment_list.view' },
      // { label: 'Study Material',        path: '/academics/study-material-list',        icon: BookOpenCheck,  permission: 'academics.study_material_list.view' },
      // { label: 'Syllabus',              path: '/academics/syllabus-list',              icon: BookMarked,     permission: 'academics.syllabus_list.view' },
      // { label: 'Other Downloads',       path: '/academics/other-downloads-list',       icon: FileText,       permission: 'academics.other_downloads_list.view' },
    ],
  },
  {
    id: 'exam',
    name: 'Examination',
    path: '/exams/command-center',
    icon: ClipboardList,
    bg: '#FDF4FF',
    ic: '#A21CAF',
    permission: 'examination',
    // Regrouped by how often each area changes (was 14 flat tabs) — the old
    // pages themselves are untouched and still reachable directly; this is
    // just the new tab set. See app/(dashboard)/exams/command-center/page.tsx.
    sub: [
      { label: 'Command Center',      path: '/exams/command-center',        icon: LayoutDashboard },
      { label: 'Exam Configuration',  path: '/exams/exam-type',             icon: FileText,       permission: 'examination.exam_type.view' },
      { label: 'Exam Setup',          path: '/exams/setup',                 icon: Settings,       permission: 'examination.exam_setup.view' },
      { label: 'Schedule & Logistics',path: '/exams/schedule',              icon: Calendar,       permission: 'examination.exam_schedule.view' },
      { label: 'Conduct & Marks',     path: '/exams/marks-register-create', icon: ClipboardCheck, permission: 'examination.add_marks.view' },
      { label: 'Results & Reports',   path: '/exams/result-publish',        icon: Globe,          permission: 'examination.result_publish.view' },
    ],
  },
  {
    id: 'reports',
    name: 'Reports',
    path: '/reports',
    icon: BarChart2,
    bg: '#FFF1F2',
    ic: '#BE123C',
    sub: [
      { label: 'Student Report', path: '/reports/student', icon: FileBarChart },
      { label: 'Student List', path: '/reports/student-list', icon: Users },
      { label: 'Student Attendance', path: '/reports/student-attendance', icon: UserCheck },
      { label: 'Exam Result', path: '/reports/exam-result', icon: ClipboardList },
      { label: 'Exam Merit', path: '/reports/exam-merit', icon: Award },
      { label: 'Staff List', path: '/reports/staff-list', icon: UserCog },
      { label: 'Staff Attendance', path: '/reports/staff-attendance', icon: UserCheck },
      { label: 'Fees Collection', path: '/reports/fees-collection', icon: HandCoins },
      { label: 'Fees Due', path: '/reports/fees-due', icon: AlertCircle },
      { label: 'Accounts Ledger', path: '/reports/accounts-ledger', icon: Landmark },
      { label: 'Library Issue', path: '/reports/library-issue', icon: BookmarkCheck },
      { label: 'Transport', path: '/reports/transport', icon: Bus },
      { label: 'Inventory Stock', path: '/reports/inventory-stock', icon: Package },
      { label: 'Student Export', path: '/students/export', icon: FileBarChart },
    ],
  },
  {
    id: 'fees',
    name: 'Fees',
    path: '/fees/payments',
    icon: HandCoins,
    bg: '#ECFEFF',
    ic: '#0E7490',
    permission: 'fees',
    sub: [
      { label: 'Home',              path: '/fees/payments',       icon: LayoutGrid,    permission: 'fees' },
      { label: 'Fee Configuration', path: '/fees/configuration',  icon: Settings,      permission: 'fees' },
      { label: 'Fee Assignment',    path: '/fees/fee-assignment', icon: ClipboardList, permission: 'fees' },
      { label: 'Collection',        path: '/fees/collection',     icon: CreditCard,    permission: 'fees' },
      { label: 'Dues & Reminders',  path: '/fees/dues-reminders', icon: AlertCircle,   permission: 'fees' },
      { label: 'Year-End',          path: '/fees/year-end',       icon: Calendar,      permission: 'fees' },
    ],
  },
  {
    id: 'library',
    name: 'Library',
    path: '/library/console',
    icon: BookMarked,
    bg: '#FDF2F8',
    ic: '#BE185D',
    permission: 'library',
    sub: [
      { label: 'Console', path: '/library/console', icon: LayoutGrid, permission: 'library.console.view' },
      { label: 'Catalogue', path: '/library/catalogue', icon: BookOpen },
      { label: 'Issue Desk', path: '/library/issue-desk', icon: BookmarkCheck, permission: 'library.book_issues.view' },
      { label: 'Lost and Damaged', path: '/library/lost-damaged', icon: AlertTriangle, permission: 'library.lost_damaged.view' },
      { label: 'Library Members', path: '/library/members', icon: Users },
      { label: 'Settings', path: '/library/settings', icon: Settings, permission: 'library.settings.view' },
    ],
  },
  // HIDDEN - no backend yet
  /* {
    id: 'transport',
    name: 'Transport',
    path: '/transport',
    icon: Bus,
    bg: '#EFF6FF',
    ic: '#1D4ED8',
    permission: 'transport',
    sub: [
      { label: 'Vehicles', path: '/transport/vehicles', icon: Car },
      { label: 'Routes', path: '/transport/routes', icon: Route },
      { label: 'Assign Vehicles', path: '/transport/assign-vehicles', icon: Truck },
      { label: 'Bus Tracking', path: '/transport/bus-tracking', icon: MapPin },
      { label: 'Live Tracking', path: '/transport/tracking', icon: Navigation },
      { label: 'Tracked Buses', path: '/transport/tracking/buses', icon: Bus },
      { label: 'Route Builder', path: '/transport/tracking/route-builder', icon: Route },
      { label: 'Student Report', path: '/transport/student-report', icon: FileBarChart },
    ],
  }, */
  // HIDDEN - no backend yet
  /* {
    id: 'inventory',
    name: 'Inventory',
    path: '/inventory',
    icon: Package,
    bg: '#F7FEE7',
    ic: '#4D7C0F',
    permission: 'inventory',
    sub: [
      { label: 'Inventory', path: '/inventory', icon: Store },
      { label: 'Stock Report', path: '/reports/inventory-stock', icon: FileBarChart },
    ],
  }, */
  // HIDDEN - no backend yet
  /* {
    id: 'behaviour',
    name: 'Behaviour',
    path: '/behaviour/incidents',
    icon: AlertTriangle,
    bg: '#FFF7ED',
    ic: '#C2410C',
    sub: [
      { label: 'Assign Incident', path: '/behaviour/assign-incident', icon: FlagTriangleRight },
      { label: 'Incidents', path: '/behaviour/incidents', icon: AlertTriangle },
      { label: 'Student Incident', path: '/behaviour/reports/student-incident', icon: FileBarChart },
      { label: 'Student Rank', path: '/behaviour/reports/student-rank', icon: Award },
      { label: 'Class Section Rank', path: '/behaviour/reports/class-section-rank', icon: BarChart2 },
      { label: 'Incident Report', path: '/behaviour/reports/incident-wise', icon: FileText },
      { label: 'Settings', path: '/behaviour/settings', icon: Settings },
    ],
  }, */
  {
    id: 'hr',
    name: 'Human Resource',
    path: '/hr/setup',
    icon: UserCog,
    bg: '#FEF2F2',
    ic: '#DC2626',
    permission: 'human_resource',
    sub: [
      { label: 'Setup',        path: '/hr/setup',        icon: Building2,    permission: 'human_resource' },
      { label: 'Staff list & Onboarding',    path: '/hr/directory',    icon: Users,        permission: 'human_resource' },
      { label: 'Leave',        path: '/hr/leave',        icon: Calendar,     permission: 'human_resource' },
      { label: 'Attendance',   path: '/hr/attendance',   icon: UserCheck,    permission: 'human_resource' },
      { label: 'Offboarding',  path: '/hr/offboarding',  icon: LogIn,        permission: 'human_resource' },
    ],
  },
  // HIDDEN - no backend yet
  /* {
    id: 'accounts',
    name: 'Accounts',
    path: '/finance/chart-of-accounts',
    icon: Landmark,
    bg: '#F0F9FF',
    ic: '#0369A1',
    permission: 'finance',
    sub: [
      { label: 'Chart of Accounts', path: '/finance/chart-of-accounts', icon: ChartBar },
      { label: 'Bank Accounts', path: '/finance/bank-accounts', icon: Building2 },
      { label: 'Ledger Entries', path: '/finance/ledger', icon: BanknoteIcon },
      { label: 'Fund Transfer', path: '/finance/fund-transfer', icon: ArrowRightLeft },
    ],
  }, */
  // HIDDEN - no backend yet
  /* {
    id: 'utilities',
    name: 'Utilities',
    path: '/utilities/chat',
    icon: MessageCircle,
    bg: '#F8FAFC',
    ic: '#334155',
    sub: [
      { label: 'Chat', path: '/utilities/chat', icon: MessageCircle },
      { label: 'Communication', path: '/utilities/communication', icon: Mail },
      { label: 'Invitation', path: '/utilities/invitation', icon: Send },
      { label: 'Blocked Users', path: '/utilities/blocked-users', icon: UserX },
    ],
  }, */
  {
    id: 'settings',
    name: 'Settings',
    path: '/settings/school-info',
    icon: Settings,
    bg: '#F1F5F9',
    ic: '#475569',
    permission: 'settings',
    sub: [
      { label: 'School Info',       path: '/settings/school-info',       icon: Building2,     permission: 'settings.school_info' },
      { label: 'Leave Policy',      path: '/settings/leave-policy',      icon: ClipboardList, permission: 'settings.leave_policy' },
      { label: 'Holiday Calendar',  path: '/settings/holidays',          icon: Calendar,      permission: 'settings.holidays' },
      { label: 'SMTP Settings',     path: '/settings/smtp',              icon: Mail,          permission: 'settings.smtp' },
      { label: 'Audit Log',         path: '/settings/audit-log',         icon: ShieldCheck,   permission: 'settings.audit_log' },
      { label: 'Attendance Rules',  path: '/settings/attendance-rules',  icon: UserCheck,     permission: 'settings.attendance_rules' },
      { label: 'Documents',         path: '/settings/documents',         icon: FileText,      permission: 'settings.documents' },
      { label: 'Document Branding', path: '/settings/document-branding', icon: Palette,       permission: 'settings.document_branding' },
      { label: 'Staff Profile',     path: '/settings/staff-profile',     icon: UserSearch,    permission: 'settings.staff_profile' },
    ],
  },
];

/** Flat list: module + all sub-routes — used by ⌘K and AI bot */
export const FLAT_INDEX = MODULES.flatMap((m) => [
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
