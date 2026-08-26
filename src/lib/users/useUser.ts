import { MeResponse } from "@/app/api/app/me/types";
import useSWR from "swr";

const useUser = (options?: { enabled?: boolean }) => {
  const { data, isLoading, error, mutate } = useSWR<MeResponse>(
    options?.enabled === false ? null : "/api/app/me",
  );

  return { user: data?.user, isLoading, error, mutate };
};

export default useUser;
