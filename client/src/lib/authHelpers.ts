import { useState, useEffect } from "react";

const AUTH_CHANGE_EVENT = "themison_auth_change";

export function isSignedOutLocal(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem("themison_signed_out") === "true";
}

export function setSignedOutLocal(signedOut: boolean): void {
  if (typeof window === "undefined") return;
  if (signedOut) {
    window.localStorage.setItem("themison_signed_out", "true");
    window.localStorage.removeItem("manus-runtime-user-info");
  } else {
    window.localStorage.removeItem("themison_signed_out");
  }
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

export function useSignedOutState(): [boolean, (val: boolean) => void] {
  const [signedOut, setSignedOut] = useState(isSignedOutLocal);

  useEffect(() => {
    const handler = () => {
      setSignedOut(isSignedOutLocal());
    };
    window.addEventListener(AUTH_CHANGE_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(AUTH_CHANGE_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  return [signedOut, setSignedOutLocal];
}
