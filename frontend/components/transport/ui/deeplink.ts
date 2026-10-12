"use client";
/** Record deep links (Master Prompt §8): `?id=<record>` opens its drawer, `?new=1` opens the create flow. */
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useDeepLink(onLink: (link: { id: string | null; isNew: boolean }) => void) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const handler = useRef(onLink);
  handler.current = onLink;

  useEffect(() => {
    const id = params.get("id");
    const isNew = params.get("new") === "1";
    if (!id && !isNew) return;
    handler.current({ id, isNew });
    router.replace(pathname, { scroll: false });
  }, [params, pathname, router]);
}
