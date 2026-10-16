import { redirect } from "next/navigation";
import { sectionHref } from "@/lib/transport/sections";

/** Fuel Management now lives as a section of the Maintenance page (/transport/maintenance). Old links and bookmarks (incl. ?id= / ?new=1) are redirected to that section. */
export default function TransportFuelRoute({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  redirect(sectionHref("/transport/maintenance", "fuel", searchParams));
}
