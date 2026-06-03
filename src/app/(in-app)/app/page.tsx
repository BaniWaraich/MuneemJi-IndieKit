import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function AppIndexPage() {
  const session = await auth();
  const role = session?.user?.role;

  if (!session?.user) redirect("/sign-in");
  if (role === "business_owner") redirect("/owner/dashboard");
  redirect("/dashboard");
}
