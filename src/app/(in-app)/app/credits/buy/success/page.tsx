import { PlanProvider } from "@/lib/plans/getSubscribeUrl";
import CreditsSuccessRedirector from "./CreditsSuccessRedirector";

export default async function CreditsSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{
    sessionId?: string; // STRIPE (using sessionId to match URL pattern)
    provider: PlanProvider;
    creditType?: string;
    amount?: string;
    paypalContextId?: string; // PAYPAL
  }>;
}) {
  const { provider, sessionId, paypalContextId } = await searchParams;

  // For now, we'll assume success and let the success component handle the display
  // In a real implementation, you might want to verify the payment status here
  // similar to how it's done in the subscription success page

  switch (provider) {
    case PlanProvider.STRIPE:
      // You could verify the Stripe session here if needed
      if (sessionId) {
        // Optionally verify the session status
      }
      break;
    case PlanProvider.PAYPAL:
      // You could verify the PayPal payment here if needed  
      if (paypalContextId) {
        // Optionally verify the payment status using context ID
      }
      break;
  }

  return <CreditsSuccessRedirector />;
}
