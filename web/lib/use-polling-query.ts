"use client";
import { useQuery, type DefaultError, type QueryClient, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";
import { useRefreshActivity } from "./use-adaptive-refresh";
import { useDisplay } from "../store/display";
import { managedPollingInterval } from "./display";

/** Apply the device refresh preference to every periodically refreshed query. Manual refresh stays available. */
export function usePollingQuery<TQueryFnData = unknown, TError = DefaultError, TData = TQueryFnData, TQueryKey extends QueryKey = QueryKey>(
  options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>, client?: QueryClient,
) {
  const active = useRefreshActivity(), configured = useDisplay(s => s.refreshInterval);
  return useQuery({ ...options, refetchIntervalInBackground: false,
    refetchInterval: query => {
      const requested = typeof options.refetchInterval === "function" ? options.refetchInterval(query) : options.refetchInterval;
      return managedPollingInterval(configured, requested, active, query.state.fetchFailureCount);
    },
    retryDelay: options.retryDelay ?? (attempt => Math.min(30_000, 1000 * 2 ** attempt)),
  }, client);
}
