"use client";

// Thin wrapper around `sonner` so feature pages can do either:
//   import { toast } from "@/components/ui/toast"; toast.success("hi")
// or
//   const toast = useToast(); toast.success("Title", "Message")
//
// The actual <Toaster /> instance lives in app/layout.tsx.

import { toast as sonner } from "sonner";

export { toast } from "sonner";
export type { ExternalToast } from "sonner";

type ToastFn = (title: string, message?: string) => void;

export interface AdminToast {
  success: ToastFn;
  error: ToastFn;
  info: ToastFn;
  warning: ToastFn;
  message: ToastFn;
}

function make(kind: "success" | "error" | "info" | "warning" | "message"): ToastFn {
  return (title, message) => {
    const fn = sonner[kind] as (msg: string, opts?: { description?: string }) => void;
    if (message) fn(title, { description: message });
    else fn(title);
  };
}

const instance: AdminToast = {
  success: make("success"),
  error: make("error"),
  info: make("info"),
  warning: make("warning"),
  message: make("message"),
};

export function useToast(): AdminToast {
  return instance;
}
