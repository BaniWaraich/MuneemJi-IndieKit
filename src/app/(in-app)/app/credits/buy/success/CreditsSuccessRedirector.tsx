"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Coins } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function CreditsSuccessRedirector() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [countdown, setCountdown] = useState(10);
  
  const creditType = searchParams.get("creditType");
  const amount = searchParams.get("amount");
  const provider = searchParams.get("provider");

  useEffect(() => {
    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          router.push("/app");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(countdownInterval);
    };
  }, [router]);

  return (
    <div className="container max-w-lg mx-auto py-12">
      <Card className="p-6">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
          </div>
          
          <h1 className="text-2xl font-bold">Credits Purchased Successfully! 🎉</h1>
          
          <div className="flex items-center gap-2 text-lg">
            <Coins className="h-5 w-5 text-primary" />
            <span className="font-semibold">{amount} credits</span>
            <span className="text-muted-foreground">for {creditType}</span>
          </div>
          
          <p className="text-muted-foreground">
            Thank you for your purchase! You will be redirected to the dashboard
            in <span className="font-medium">{countdown}</span> seconds.
          </p>

          <p className="text-muted-foreground text-sm">
            Your credits have been added to your account and are ready to use.
          </p>

          {provider && (
            <p className="text-muted-foreground text-sm">
              Payment processed via{" "}
              {provider === "stripe"
                ? "Stripe"
                : provider === "polar"
                  ? "Polar"
                  : provider === "paypal"
                    ? "PayPal"
                    : provider === "dodo"
                      ? "Dodo Payments"
                      : provider === "paddle"
                        ? "Paddle"
                        : provider === "lemonsqueezy"
                          ? "Lemon Squeezy"
                          : provider}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-2 items-center w-full">
            <Button asChild className="w-full sm:w-auto">
              <Link href="/app">Go to Dashboard</Link>
            </Button>
            <Button variant="outline" asChild className="w-full sm:w-auto">
              <Link href="/app/credits/history">View Credits</Link>
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
