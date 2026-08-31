"use client";

import { useEffect, type ReactNode } from "react";
import { toast } from "@/components/feedback/toast-provider";
import { loadMemberSubmission } from "./issue-creator-client";
import { submissionOutcome } from "./submission-outcome";

export const SUBMISSION_TRACK_EVENT = "which:submission-track";
export const SUBMISSION_UPDATED_EVENT = "which:submission-updated";
const SUBMISSION_FORGET_EVENT = "which:submission-forget";
const STORAGE_KEY = "which:pending-submissions:v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
type TrackedSubmission = { id: string; revision: number; startedAt: number; delayed?: boolean };

function validEntry(value: unknown): value is TrackedSubmission {
  if (!value || typeof value !== "object") return false;
  const item = value as TrackedSubmission;
  return (
    typeof item.id === "string" &&
    /^[a-z0-9-]{1,64}$/i.test(item.id) &&
    Number.isInteger(item.revision) &&
    item.revision > 0 &&
    Number.isFinite(item.startedAt) &&
    item.startedAt <= Date.now() &&
    Date.now() - item.startedAt < MAX_AGE_MS
  );
}

function readTracked(): TrackedSubmission[] {
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter(validEntry) : [];
  } catch {
    return [];
  }
}

function saveTracked(items: TrackedSubmission[]) {
  try {
    if (items.length) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Tracking still works in memory when storage is unavailable. */
  }
}

export function trackSubmission(item: { id: string; revision: number }) {
  if (typeof window === "undefined") return;
  const entry: TrackedSubmission = { ...item, startedAt: Date.now() };
  const previous = readTracked();
  if (
    !validEntry(entry) ||
    previous.some((row) => row.id === item.id && row.revision > item.revision)
  )
    return;
  saveTracked([...previous.filter((row) => row.id !== item.id), entry]);
  window.dispatchEvent(new CustomEvent(SUBMISSION_TRACK_EVENT, { detail: entry }));
}

// Explicit text/library/cancel actions already show their own result toast.
export function forgetSubmission(id: string) {
  saveTracked(readTracked().filter((item) => item.id !== id));
  window.dispatchEvent(new CustomEvent(SUBMISSION_FORGET_EVENT, { detail: id }));
}

// Mounted above page navigation: closing the composer must not end result tracking.
// Polls are read-only. Only an actual server outcome can produce success/failure.
export function SubmissionFeedbackProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const tracked = new Map(readTracked().map((item) => [item.id, item]));
    const observed = new Map<string, string>();
    let stopped = false;
    let polling = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const save = () => saveTracked([...tracked.values()]);
    const schedule = (delay: number) => {
      clearTimeout(timer);
      if (!stopped && tracked.size) timer = setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (stopped || polling || document.visibilityState === "hidden") return;
      polling = true;
      try {
        // Bound concurrent reads and rotate large queues without limiting submissions.
        for (const entry of [...tracked.values()].slice(0, 5)) {
          if (stopped) break;
          const id = entry.id;
          if (!validEntry(entry)) {
            tracked.delete(id);
            save();
            continue;
          }
          tracked.delete(entry.id);
          tracked.set(entry.id, entry);
          controller = new AbortController();
          const timeout = setTimeout(() => controller?.abort(), 12000);
          try {
            const item = await loadMemberSubmission(entry.id, controller.signal);
            if (stopped || tracked.get(entry.id) !== entry) continue;
            if (!item) {
              tracked.delete(entry.id);
              save();
              continue;
            }
            if (item.revision < entry.revision) continue;
            const outcome = submissionOutcome(item);
            const signature = JSON.stringify([
              item.revision,
              item.status,
              item.publicationState,
              item.publishedIssueId,
              item.reviewNote,
            ]);
            if (observed.get(item.id) !== signature) {
              observed.set(item.id, signature);
              window.dispatchEvent(new Event(SUBMISSION_UPDATED_EVENT));
            }
            if (outcome !== "processing") {
              tracked.delete(entry.id);
              save();
              if (outcome === "published") toast.success("질문이 게시되었어요.");
              if (outcome === "failed")
                toast.error("질문을 게시하지 못했어요. 내 질문에서 사유를 확인해 주세요.");
            } else if (!entry.delayed && Date.now() - entry.startedAt >= 5 * 60 * 1000) {
              entry.delayed = true;
              save();
              toast.info("게시 결과를 기다리고 있어요. 내 질문에서 진행 상태를 확인할 수 있어요.");
            }
          } catch (error) {
            if (stopped) break;
            if ((error as { status?: number }).status === 401) {
              tracked.clear();
              save();
              break;
            }
            if ([400, 404].includes((error as { status?: number }).status ?? 0)) {
              tracked.delete(entry.id);
              save();
            }
            // Network failures and timeouts are not publication failures.
          } finally {
            clearTimeout(timeout);
          }
        }
      } finally {
        polling = false;
        schedule([...tracked.values()].every((item) => item.delayed) ? 30000 : 5000);
      }
    };
    const onTrack = (event: Event) => {
      const item: unknown = (event as CustomEvent).detail;
      if (!validEntry(item)) return;
      const current = tracked.get(item.id);
      if (current && current.revision > item.revision) return;
      tracked.set(item.id, item);
      save();
      schedule(0);
    };
    const onVisible = () => {
      if (document.visibilityState !== "hidden") schedule(0);
    };
    const onForget = (event: Event) => {
      const id: unknown = (event as CustomEvent).detail;
      if (typeof id === "string") {
        tracked.delete(id);
        observed.delete(id);
        save();
      }
    };
    window.addEventListener(SUBMISSION_TRACK_EVENT, onTrack);
    window.addEventListener(SUBMISSION_FORGET_EVENT, onForget);
    document.addEventListener("visibilitychange", onVisible);
    schedule(0);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      window.removeEventListener(SUBMISSION_TRACK_EVENT, onTrack);
      window.removeEventListener(SUBMISSION_FORGET_EVENT, onForget);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return children;
}
