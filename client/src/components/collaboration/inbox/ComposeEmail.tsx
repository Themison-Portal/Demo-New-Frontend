import { FormEvent, useState } from "react";
import { Brain } from "lucide-react";
import type { DraftResult } from "@/types/collaboration";

interface ComposeEmailProps {
    onSend: (input: { to: string[]; cc: string[]; subject: string; body: string }) => Promise<void>;
    onDraftWithAI: (instructions?: string) => Promise<DraftResult>;
}

export function ComposeEmail({ onSend, onDraftWithAI }: ComposeEmailProps) {
    const [to, setTo] = useState("");
    const [cc, setCc] = useState("");
    const [subject, setSubject] = useState("");
    const [body, setBody] = useState("");
    const [instructions, setInstructions] = useState("");
    const [drafting, setDrafting] = useState(false);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        event.stopPropagation();
        console.log("submit called");
        await onSend({
            to: to.split(",").map((item) => item.trim()).filter(Boolean),
            cc: cc.split(",").map((item) => item.trim()).filter(Boolean),
            subject,
            body,
        });
        setBody("");
        setSubject("");
    };

    const draftWithAI = async () => {
        setDrafting(true);
        try {
            const draft = await onDraftWithAI(instructions || undefined);
            setSubject(draft.subject);
            setBody(draft.body);
        } finally {
            setDrafting(false);
        }
    };

    return (
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-neutral-300 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-neutral-900">Compose Email</div>
            <input className="h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm" placeholder="To (comma-separated)" value={to} onChange={(event) => setTo(event.target.value)} />
            <input className="h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm" placeholder="CC" value={cc} onChange={(event) => setCc(event.target.value)} />
            <input className="h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm" placeholder="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
            <textarea className="min-h-[180px] w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm" placeholder="Body" value={body} onChange={(event) => setBody(event.target.value)} />

            <div className="rounded-xl border border-neutral-300 bg-neutral-50 p-3">
                <div className="mb-1 inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600">
                    <Brain className="h-3.5 w-3.5 text-indigo-600" />
                    Draft with Themison AI
                </div>
                <input
                    className="h-9 w-full rounded-lg border border-neutral-300 px-2 text-xs"
                    placeholder="Any specific instructions?"
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                />
                <button type="button" onClick={draftWithAI} disabled={drafting} className="mt-2 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-60">
                    {drafting ? "Generating with Themison AI..." : "Generate with Themison AI"}
                </button>
            </div>

            <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
                Send
            </button>
        </form>
    );
}
