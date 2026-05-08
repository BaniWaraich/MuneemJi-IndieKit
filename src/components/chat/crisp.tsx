import useUser from "@/lib/users/useUser";
import { Crisp } from "crisp-sdk-web";
import { useEffect } from "react";

const crispWebsiteId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID;
export const CrispChat = () => {
  const { user, isLoading } = useUser();
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
