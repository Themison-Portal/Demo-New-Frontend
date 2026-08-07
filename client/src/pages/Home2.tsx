import { ArrowRight } from "lucide-react";
import { useMemo } from "react";
import { useDemoState } from "@/contexts/DemoStateContext";
import { Link } from "wouter";
import { Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";

export default function Home2() {
  const { state } = useDemoState();

  const runtimeUser = useMemo(() => {
    if (typeof window === "undefined") {
      return { name: "Kaleb Sanders", email: "kaleb.s@azorg.be" };
    }
    try {
      const raw = window.localStorage.getItem("manus-runtime-user-info");
      if (!raw) return { name: "Kaleb Sanders", email: "kaleb.s@azorg.be" };
      const parsed = JSON.parse(raw) as { name?: unknown; email?: unknown };
      return {
        name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : "Kaleb Sanders",
        email: typeof parsed.email === "string" && parsed.email.trim() ? parsed.email.trim() : "kaleb.s@azorg.be",
      };
    } catch {
      return { name: "Kaleb Sanders", email: "kaleb.s@azorg.be" };
    }
  }, []);

  const currentMember = useMemo(() => {
    const normalizedRuntimeEmail = runtimeUser.email.toLowerCase();
    const normalizedRuntimeName = runtimeUser.name.toLowerCase();
    const matchedByEmail = state.teamMembers.find(
      (member) => member.email.toLowerCase() === normalizedRuntimeEmail
    );
    if (matchedByEmail) return matchedByEmail;
    const matchedByName = state.teamMembers.find(
      (member) => member.name.toLowerCase() === normalizedRuntimeName
    );
    return matchedByName ?? null;
  }, [runtimeUser.email, runtimeUser.name, state.teamMembers]);

  const displayName = useMemo(() => {
    return currentMember?.name || runtimeUser.name || "User";
  }, [currentMember?.name, runtimeUser.name]);

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#F7F8FB] px-8 pb-8 pt-4">
      <article className="relative min-h-[430px] w-full max-w-[530px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-none">
        <div className="absolute bottom-[52px] left-[145px] right-2 top-[15px] overflow-hidden rounded-[8px]">
          <div
            className="absolute inset-0 z-0 bg-center bg-no-repeat opacity-25"
            style={{
              backgroundImage: "url('/vision/eclipseframer.svg')",
              backgroundSize: "100% 100%",
            }}
          />
          <iframe
            src="https://my.spline.design/particleaibraincopycopy-HKDz858gzcKxD2SysKCQOoyn/"
            title="Brain Spline Animation"
            className="pointer-events-auto absolute z-10 left-[59.5%] top-[55%] h-[190%] w-[190%] origin-center -translate-x-1/2 -translate-y-1/2 scale-[0.64] border-0"
            loading="lazy"
            allow="autoplay; fullscreen"
          />
        </div>

        <div className="px-5 pb-6 pt-[18px]">
          <p className="text-[14px] font-medium leading-[20px] text-[#75778B]">Welcome back,</p>
          <h2 className="mt-2 text-[32px] font-semibold leading-none tracking-[-0.03em] text-[#0E0017]">
            {displayName}
          </h2>
          <p className="mt-4 text-[14px] font-medium leading-[20px] text-[#75778B]">Glad to see you again!</p>
          <p className="text-[14px] font-medium leading-[20px] text-[#75778B]">Ask me anything.</p>
        </div>

        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-[#FAFAFA] px-5 py-3">
          <p className="whitespace-nowrap text-[14px] font-medium leading-[20px] text-[#0E0017]">Open Themison AI</p>
          <Link
            href="/documents"
            aria-label="Open Themison AI"
            className="flex h-8 w-8 translate-x-1 items-center justify-center rounded-md transition-colors hover:bg-[#EEF1F7]"
          >
            <ArrowRight className="h-4 w-4 text-[#75778B]" />
          </Link>
        </div>
      </article>

      <article className="relative mt-4 min-h-[430px] w-full max-w-[530px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-none">
        <div className="relative pb-0 px-5 pt-6">
          <h3 className="text-[22px] leading-[1.1] font-semibold text-[#0E0017]">What&apos;s Important Today</h3>
        </div>

        <div className="relative mt-[250px] px-5 pb-6 text-[#0E0017]">
          <div className="space-y-2 text-[14px] leading-snug">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#75778B]" />
              <span>You have 0 tasks due today</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[#75778B]" />
              <span>64 tasks are overdue</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#75778B]" />
              <span>Completed yesterday: 0 tasks</span>
            </div>
          </div>
          <p className="mt-4 text-[11px] uppercase tracking-wider text-[#75778B]">
            Live feed powered by Themison AI
          </p>
        </div>
      </article>
    </div>
  );
}
