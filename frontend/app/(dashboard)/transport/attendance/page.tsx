import { redirect } from "next/navigation";
import { sectionHref } from "@/lib/transport/sections";

/** Transport Attendance now lives as a section of the Allocation page (/transport/allocation). Old links and bookmarks (incl. ?id= / ?new=1) are redirected to that section. */
export default function TransportAttendanceRoute({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  redirect(sectionHref("/transport/allocation", "attendance", searchParams));
}
