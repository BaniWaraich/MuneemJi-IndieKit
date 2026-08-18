import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { OwnerLoginForm } from "./owner-login-form";

export const metadata = {
  title: "Sign in — Business owner",
  description: "Sign in to your Muneem Ji client account",
};

export default async function OwnerLoginPage() {
  const session = await auth();
  if (session?.user.role === "business_owner") {
    redirect("/owner/dashboard");
  }

  return <OwnerLoginForm />;
}
