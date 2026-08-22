import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { OwnerSignupForm } from "./owner-signup-form";

export const metadata = {
  title: "Create account — Business owner",
  description: "Create a Muneem Ji account to collect invoices and statements",
};

export default async function OwnerSignupPage() {
  const session = await auth();
  if (session?.user.role === "business_owner") {
    redirect("/owner/onboarding");
  }

  return <OwnerSignupForm />;
}
