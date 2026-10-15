import { redirect } from "next/navigation";
import { sectionHref } from "@/lib/transport/sections";

/** Attendants now live as a section of the Staff page (/transport/drivers). Old links and bookmarks (incl. ?id= / ?new=1) are redirected to that section. */
export default function TransportAttendantsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  redirect(sectionHref("/transport/drivers", "attendants", searchParams));
}
