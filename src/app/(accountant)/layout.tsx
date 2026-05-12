import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SidebarShell } from "./sidebar-shell";

export default async function AccountantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (
    !session ||
    (session.user.role !== "ca_admin" && session.user.role !== "ca_staff") ||
    !session.user.firmId
  ) {
    redirect("/login");
  }

  return (
    <SidebarShell email={session.user.email ?? ""}>{children}</SidebarShell>
  );
}
