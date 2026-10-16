import { redirect } from "next/navigation";
import { sectionHref } from "@/lib/transport/sections";

/** Pickup Points now live as a section of the Routes page (/transport/routes). Old links and bookmarks (incl. ?id= / ?new=1) are redirected to that section. */
export default function TransportPickupPointsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  redirect(sectionHref("/transport/routes", "pickup-points", searchParams));
}
