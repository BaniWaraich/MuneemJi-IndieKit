import { redirect } from "next/navigation";

export default function OwnerPendingRedirect() {
  redirect("/owner/dashboard");
}
