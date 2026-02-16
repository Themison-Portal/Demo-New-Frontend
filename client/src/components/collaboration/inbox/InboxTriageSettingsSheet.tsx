import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { InboxAILabel, InboxLabelSetting, InboxTriageSettings } from "@/types/collaboration";

interface InboxTriageSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: InboxTriageSettings;
  onUpdateLabel: (
    label: InboxAILabel,
    patch: Partial<Omit<InboxLabelSetting, "key">>
  ) => void;
  onUpdateConfidence: (confidence: number) => void;
  onReset: () => void;
}

export function InboxTriageSettingsSheet({
  open,
  onOpenChange,
  settings,
  onUpdateLabel,
  onUpdateConfidence,
  onReset,
}: InboxTriageSettingsSheetProps) {
  const confidence = settings.autoApplyConfidence ?? settings.confidenceThreshold ?? 0.7;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[440px] overflow-y-auto sm:max-w-[440px]">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base font-semibold">Themison AI Triage</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          <div className="rounded-lg border border-gray-200 p-3">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Minimum confidence ({Math.round(confidence * 100)}%)
            </label>
            <Input
              type="range"
              min={0}
              max={100}
              value={Math.round(confidence * 100)}
              onChange={(event) => {
                const value = Number(event.target.value);
                onUpdateConfidence(Number.isFinite(value) ? Math.max(0, Math.min(1, value / 100)) : 0.7);
              }}
            />
          </div>

          <div className="space-y-2">
            {settings.labels.map((label) => (
              <div key={label.key} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{label.displayName}</p>
                    <p className="text-xs text-gray-500">{label.key}</p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={Boolean(label.enabled)}
                      onChange={(event) =>
                        onUpdateLabel(label.key, { enabled: event.target.checked })
                      }
                    />
                    Enabled
                  </label>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <p className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">Pill color</p>
                    <Input
                      value={label.color}
                      onChange={(event) => onUpdateLabel(label.key, { color: event.target.value })}
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">Text color</p>
                    <Input
                      value={label.textColor}
                      onChange={(event) => onUpdateLabel(label.key, { textColor: event.target.value })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Button type="button" variant="outline" className="w-full" onClick={onReset}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset defaults
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
