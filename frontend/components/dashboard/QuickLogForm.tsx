"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createInteraction } from "@/lib/api";
import { URGENCY_META } from "@/lib/urgency";
import { cn } from "@/lib/utils";
import type { CompanyWithScore, InteractionType, UrgencyLevel } from "@/types";

const INTERACTION_TYPES: { value: InteractionType; label: string }[] = [
  { value: "meeting", label: "Meeting" },
  { value: "email", label: "Email" },
  { value: "call", label: "Call" },
  { value: "demo", label: "Demo" },
  { value: "support_call", label: "Support call" },
];

const URGENCY_OPTIONS: UrgencyLevel[] = ["hot", "watch", "stable", "stale"];

const EYEBROW = "text-[11px] font-medium uppercase tracking-wider text-muted-foreground";

export function QuickLogForm({
  company,
  onSaved,
  onCancel,
}: {
  company: CompanyWithScore;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [contactId, setContactId] = useState<string>(company.contacts[0]?.id ?? "");
  const [type, setType] = useState<InteractionType>("call");
  const [notes, setNotes] = useState("");
  const [urgency, setUrgency] = useState<UrgencyLevel>(company.score.urgency);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    if (!notes.trim()) {
      toast.error("Add a note before saving.");
      return;
    }
    setIsSaving(true);
    try {
      const contact = company.contacts.find((c) => c.id === contactId) ?? null;
      await createInteraction({
        companyId: company.id,
        contactId: contact?.id ?? null,
        contactName: contact?.name ?? null,
        date: new Date().toISOString().slice(0, 10),
        type,
        notes: notes.trim(),
        urgency,
      });
      toast.success(`Logged. ${company.name} updated to ${URGENCY_META[urgency].label}.`);
      onSaved();
    } catch {
      toast.error("Couldn't save that interaction — try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="quick-log-contact" className={EYEBROW}>
            Contact
          </Label>
          <Select value={contactId} onValueChange={(v) => v && setContactId(v)}>
            <SelectTrigger id="quick-log-contact" className="h-8 w-full bg-card text-sm">
              <SelectValue placeholder="Select contact" />
            </SelectTrigger>
            <SelectContent>
              {company.contacts.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
              {company.contacts.length === 0 && (
                <SelectItem value="__none" disabled>
                  No contacts on file
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="quick-log-type" className={EYEBROW}>
            Type
          </Label>
          <Select value={type} onValueChange={(v) => v && setType(v as InteractionType)}>
            <SelectTrigger id="quick-log-type" className="h-8 w-full bg-card text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERACTION_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="quick-log-notes" className={EYEBROW}>
          Notes
        </Label>
        <Textarea
          id="quick-log-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What happened?"
          rows={3}
          className="resize-none bg-card text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="quick-log-urgency" className={EYEBROW}>
          Urgency
        </Label>
        <Select value={urgency} onValueChange={(v) => v && setUrgency(v as UrgencyLevel)}>
          <SelectTrigger id="quick-log-urgency" className="h-8 w-full bg-card text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {URGENCY_OPTIONS.map((level) => (
              <SelectItem key={level} value={level}>
                <span className="flex items-center gap-2">
                  <span
                    className={cn("size-1.5 rounded-full", URGENCY_META[level].dotClassName)}
                    aria-hidden
                  />
                  {URGENCY_META[level].label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end gap-2 pt-0.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={onCancel}
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button size="sm" className="h-8 text-xs" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving…" : "Save + reanalyse"}
        </Button>
      </div>
    </div>
  );
}
