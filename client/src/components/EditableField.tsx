/**
 * EditableField Component
 * Displays a field with inline editing on hover (pencil icon appears)
 * Supports text, textarea, select, and date inputs
 */

import { useState, useRef, useEffect } from "react";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type EditableFieldProps = {
  value: string | null | undefined;
  displayValue?: string | null | undefined;
  onSave: (newValue: string) => Promise<void>;
  type?: "text" | "textarea" | "select" | "date";
  options?: { value: string; label: string }[]; // For select type
  placeholder?: string;
  className?: string;
  displayClassName?: string;
  emptyText?: string; // Text to show when value is empty
};

export function EditableField({
  value,
  displayValue,
  onSave,
  type = "text",
  options = [],
  placeholder,
  className,
  displayClassName,
  emptyText = "Add value",
}: EditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || "");
  const [isHovered, setIsHovered] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const isEmpty = !value || value.trim() === "";
  const renderedValue = displayValue ?? value;

  // Update editValue when value prop changes
  useEffect(() => {
    setEditValue(value || "");
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      if (type === "text" || type === "textarea") {
        inputRef.current.select();
      }
    }
  }, [isEditing, type]);

  const handleSave = async () => {
    if (editValue === value) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(editValue);
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to save:", error);
      // Revert on error
      setEditValue(value || "");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditValue(value || "");
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && type !== "textarea") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className={cn("flex items-start gap-2", className)}>
        {type === "text" && (
          <Input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            placeholder={placeholder}
            disabled={isSaving}
            className="h-8"
          />
        )}

        {type === "textarea" && (
          <Textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isSaving}
            className="min-h-[80px]"
          />
        )}

        {type === "select" && (
          <Select value={editValue} onValueChange={setEditValue} disabled={isSaving}>
            <SelectTrigger className="h-8">
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {type === "date" && (
          <Input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="date"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSaving}
            className="h-8"
          />
        )}

        <div className="flex items-center gap-1 flex-shrink-0">
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          ) : (
            <>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={handleSave}
              >
                <Check className="h-4 w-4 text-green-600" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={handleCancel}
              >
                <X className="h-4 w-4 text-red-600" />
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative inline-flex items-center gap-2 cursor-pointer",
        className
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => setIsEditing(true)}
    >
      <span
        className={cn(
          isEmpty && "text-gray-400 italic",
          displayClassName
        )}
      >
        {isEmpty ? emptyText : renderedValue}
      </span>
      {isHovered && (
        <Pencil className="h-3.5 w-3.5 text-gray-400 group-hover:text-gray-600 flex-shrink-0" />
      )}
    </div>
  );
}
