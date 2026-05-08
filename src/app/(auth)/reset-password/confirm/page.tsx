"use client";

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FaSpinner } from "react-icons/fa";
import { toast } from "sonner";
import { resetPasswordConfirmSchema, type ResetPasswordConfirmInput } from "@/lib/validations/auth.schema";
import { appConfig } from "@/lib/config";

export default function ResetPasswordConfirmPage() {
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [tokenError, setTokenError] = React.useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams?.get("token");

  React.useEffect(() => {
    if (!token) {
      setTokenError("Invalid or missing token. Please request a new password reset link.");
    }
  }, [token]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordConfirmInput>({
    resolver: zodResolver(resetPasswordConfirmSchema),
  });

  const onSubmit = async (data: ResetPasswordConfirmInput) => {
    if (!token) {
      toast.error("Invalid token");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/reset-password-confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          password: data.password,
          confirmPassword: data.confirmPassword,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        toast.error(result.error || "Failed to reset password");
        return;
      }

      toast.success("Password reset successfully! Please sign in.");
      router.push("/sign-in");
    } catch (error) {
      console.error("Reset password error:", error);
      toast.error("Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  if (tokenError) {
    return (
      <div className="flex flex-col gap-6">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight mb-2">
            Invalid Link
          </h1>
          <p className="text-sm text-muted-foreground">
            {tokenError}
          </p>
        </div>
        <Button onClick={() => router.push("/reset-password")} className="w-full py-6">
          Request New Link
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">
          Reset Your Password
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter your new password for your {appConfig.projectName} account
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">New Password</Label>
          <Input
            id="password"
            placeholder="Enter your new password"
            type="password"
            autoComplete="new-password"
            disabled={isLoading}
            {...register("password")}
            className="w-full py-6"
          />
          {errors.password && (
            <p className="text-sm text-destructive">{errors.password.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="confirmPassword">Confirm New Password</Label>
          <Input
            id="confirmPassword"
            placeholder="Confirm your new password"
            type="password"
            autoComplete="new-password"
            disabled={isLoading}
            {...register("confirmPassword")}
            className="w-full py-6"
          />
          {errors.confirmPassword && (
            <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
          )}
        </div>

        <Button type="submit" disabled={isLoading} className="w-full py-6">
          {isLoading && <FaSpinner className="mr-2 h-4 w-4 animate-spin" />}
          Reset Password
        </Button>
      </form>
    </>
  );
}

