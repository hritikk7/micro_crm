"use client";

import useSWR from "swr";

import { fetchPriorities } from "@/lib/api";
import type { PrioritiesResponse } from "@/types";

const PRIORITIES_KEY = "priorities";

export function usePriorities() {
  const { data, error, isLoading, mutate } = useSWR<PrioritiesResponse>(
    PRIORITIES_KEY,
    fetchPriorities,
  );

  return {
    data,
    isLoading,
    error: error as Error | undefined,
    mutate,
  };
}
