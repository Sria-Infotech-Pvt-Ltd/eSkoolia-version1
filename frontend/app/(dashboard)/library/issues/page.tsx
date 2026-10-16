import { redirect } from "next/navigation";

// Replaced by /library/issue-desk. Kept for one release so bookmarks and the old menu entries still work.
export default function LibraryIssuesRedirect() {
  redirect("/library/issue-desk");
}
