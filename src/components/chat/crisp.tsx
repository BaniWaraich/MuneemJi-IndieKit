"use client";

import useUser from "@/lib/users/useUser";
import { Crisp } from "crisp-sdk-web";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const crispWebsiteId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID;
export const CrispChat = () => {
  const pathname = usePathname();
  // BO sessions live in client_users, not app_user — /api/app/me 401s and
  // SWR retries would surface as a client exception on /owner/*.
  const { user, isLoading } = useUser({
    enabled: !pathname.startsWith("/owner"),
  });
  useEffect(() => {
    if (!crispWebsiteId) {
      return;
    }
    Crisp.configure(crispWebsiteId);
  }, []);

  useEffect(() => {
    if (!user || isLoading || !crispWebsiteId) {
      return;
    }
    Crisp.user.setEmail(user.email);
    Crisp.user.setNickname(user.name || user.email.split("@")[0]);
    Crisp.session.setData(user);
  }, [user, isLoading]);

  return null;
};
