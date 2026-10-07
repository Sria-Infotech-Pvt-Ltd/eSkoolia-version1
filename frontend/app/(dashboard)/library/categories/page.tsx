import { redirect } from "next/navigation";

// Replaced by /library/catalogue. Kept for one release so bookmarks and the old menu entries still work.
export default function LibraryCatalogueRedirect() {
  redirect("/library/catalogue");
}
